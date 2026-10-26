import fs from 'node:fs';
import { adaptKazumi, adaptLNReader, adaptVenera, adaptMangayomi } from '@titanhub/plugin-adapter';
import { loadMarketCatalog, type MarketPlugin } from '../src/sources/catalog';
import { PluginSandbox, type SandboxResult } from '../src/plugins/sandbox';
import type { MediaType } from '@titanhub/plugin-types';

type Stage = 'download' | 'adapt' | 'search' | 'detail' | 'chapters' | 'content';
interface Outcome {
  id: string;
  name: string;
  sourceType: string;
  type: string;
  lang?: string;
  status: 'pass' | 'fail' | 'skipped';
  reached: Stage | 'none';
  failedAt?: Stage;
  error?: string;
  query?: string;
  results?: number;
  chapters?: number;
  evidence?: string;
  ms: number;
}

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(key, value);
}
const outFile = args.get('out') ?? 'source-verification.json';
const offset = Number(args.get('offset') ?? 0);
const limit = Number(args.get('limit') ?? Infinity);
const concurrency = Number(args.get('concurrency') ?? 6);
const onlyProvider = args.get('provider');
const dbFile = args.get('db');
const onlyId = args.get('id');

const QUERIES: Record<string, string[]> = {
  anime: ['海贼王', '进击的巨人'],
  movie: ['你的名字'],
  manga: ['one piece', '海贼王'],
  novel: ['love', '我的'],
};

function queriesFor(source: MarketPlugin): string[] {
  const lang = (source.lang ?? '').toLowerCase();
  const base = QUERIES[source.type] ?? ['one piece'];
  if (lang.startsWith('zh')) return source.type === 'novel' ? ['我的', '穿越'] : ['海贼王', '斗罗大陆'];
  if (lang.startsWith('ja')) return ['ワンピース'];
  return base;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function download(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function adapt(source: MarketPlugin, raw: string) {
  const bare = (suffix: RegExp) => source.name.replace(suffix, '');
  if (source.sourceType === 'kazumi') return adaptKazumi(JSON.parse(raw));
  if (source.sourceType === 'lnreader') return adaptLNReader(raw, { id: source.id, name: bare(/\s*\(LNReader\)$/i), version: source.version });
  if (source.sourceType === 'venera') return adaptVenera(raw, { id: source.id, name: bare(/\s*\(Venera\)$/i), version: source.version });
  const metadata = source.metadata as Record<string, unknown>;
  return adaptMangayomi(raw, {
    ...metadata, sourceId: metadata.id, id: source.id, name: source.name, version: source.version,
    type: source.type, baseUrl: metadata.baseUrl,
  } as never);
}

async function step<T>(stage: Stage, outcome: Outcome, run: () => Promise<SandboxResult<T>>, ms: number): Promise<T> {
  const result = await withTimeout(run(), ms, stage);
  if (!result.success || result.data === undefined) {
    outcome.failedAt = stage;
    throw new Error(result.error || `${stage} 无数据`);
  }
  outcome.reached = stage;
  return result.data;
}

async function verify(source: MarketPlugin, installedCode?: string): Promise<Outcome> {
  const started = Date.now();
  const outcome: Outcome = {
    id: source.id, name: source.name, sourceType: source.sourceType, type: source.type, lang: source.lang,
    status: 'fail', reached: 'none', ms: 0,
  };
  const finish = () => { outcome.ms = Date.now() - started; return outcome; };
  if (!source.installable) {
    outcome.status = 'skipped';
    outcome.error = source.limitation ?? '当前运行时不可安装';
    return finish();
  }
  try {
    let plugin: { id: string; code: string };
    if (installedCode !== undefined) {
      plugin = { id: source.id, code: installedCode };
    } else {
      let raw: string;
      try { raw = await download(source.downloadUrl); } catch (error) { outcome.failedAt = 'download'; throw error; }
      outcome.reached = 'download';
      try { plugin = await adapt(source, raw); } catch (error) { outcome.failedAt = 'adapt'; throw error; }
    }
    outcome.reached = 'adapt';
    const sandbox = new PluginSandbox(plugin.id, plugin.code);

    let items: { id: string; title: string }[] = [];
    let lastError = '';
    for (const query of queriesFor(source)) {
      outcome.query = query;
      const found = await withTimeout(sandbox.runMethod<{ id: string; title: string }[]>('search', [query], 25000), 30000, 'search');
      if (found.success && found.data?.length) { items = found.data; break; }
      lastError = found.success ? `搜索“${query}”无结果` : found.error ?? '搜索失败';
    }
    if (!items.length) { outcome.failedAt = 'search'; throw new Error(lastError); }
    outcome.reached = 'search';
    outcome.results = items.length;

    let chapters: { id: string; title: string }[] = [];
    for (const candidate of items.slice(0, 3)) {
      outcome.failedAt = undefined;
      await step('detail', outcome, () => sandbox.runMethod('getDetail', [candidate.id], 25000), 30000);
      chapters = await step('chapters', outcome, () => sandbox.runMethod<{ id: string; title: string }[]>('getChapters', [candidate.id], 25000), 30000).catch(error => {
        if (candidate === items.slice(0, 3).at(-1) || items.length === 1) throw error;
        return [];
      });
      if (chapters.length) break;
    }
    if (!chapters.length) { outcome.failedAt = 'chapters'; throw new Error('章节列表为空'); }
    outcome.chapters = chapters.length;

    const chapter = chapters[0];
    const kind: MediaType = source.type;
    if (kind === 'anime' || kind === 'movie') {
      const videos = await step<{ url: string }[]>('content', outcome, () => sandbox.runMethod('getVideoUrl', [chapter.id], 35000), 40000);
      if (!videos.length) { outcome.failedAt = 'content'; throw new Error('未取得视频地址'); }
      outcome.evidence = `${videos.length} 个视频地址:${videos[0].url.slice(0, 120)}`;
    } else if (kind === 'manga') {
      const images = await step<string[]>('content', outcome, () => sandbox.runMethod('getImages', [chapter.id], 25000), 30000);
      if (!images.length) { outcome.failedAt = 'content'; throw new Error('未取得漫画页'); }
      outcome.evidence = `${images.length} 页:${String(images[0]).slice(0, 120)}`;
    } else {
      const content = await step<string>('content', outcome, () => sandbox.runMethod('getContent', [chapter.id], 25000), 30000);
      if (!content || content.length < 20) { outcome.failedAt = 'content'; throw new Error('小说正文为空'); }
      outcome.evidence = `${content.length} 字符`;
    }
    outcome.status = 'pass';
  } catch (error) {
    outcome.error = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  }
  return finish();
}

async function main() {
  const installed = new Map<string, string>();
  let sources: MarketPlugin[];
  if (dbFile) {
    const SQL = await (await import('sql.js')).default();
    const db = new SQL.Database(fs.readFileSync(dbFile));
    const rows = db.exec('select id, name, version, types, code from plugins where is_active = 1')[0]?.values ?? [];
    sources = rows.map(([id, name, version, types, code]) => {
      installed.set(String(id), String(code));
      const type = (String(types).split(',')[0] || 'manga') as MediaType;
      return { id: String(id), name: String(name), version: String(version), type, sourceType: 'installed', installable: true } as unknown as MarketPlugin;
    });
  } else {
    const catalog = await loadMarketCatalog();
    console.log('目录:', catalog.providers.map(p => `${p.id}=${p.count}(${p.status})`).join(' '));
    sources = catalog.sources;
  }
  if (onlyProvider) sources = sources.filter(s => `${s.sourceType}-${s.type}`.includes(onlyProvider) || s.sourceType === onlyProvider);
  if (onlyId) sources = sources.filter(s => s.id.includes(onlyId));
  sources = sources.slice(offset, offset + limit);
  console.log(`待验证 ${sources.length} 个来源,并发 ${concurrency}`);

  const results: Outcome[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      const outcome = await verify(source, installed.get(source.id));
      results.push(outcome);
      console.log(`[${results.length}/${sources.length}] ${outcome.status.padEnd(7)} ${source.id} ${outcome.failedAt ? `@${outcome.failedAt}: ${outcome.error}` : outcome.evidence ?? ''}`.slice(0, 220));
      fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const tally = results.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
  console.log('汇总', tally, '→', outFile);
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
