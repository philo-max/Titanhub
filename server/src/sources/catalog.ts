import type { MediaType } from '@titanhub/plugin-types';

export type SourceFormat = 'kazumi' | 'venera' | 'lnreader' | 'mangayomi';

export interface MarketPlugin {
  id: string;
  name: string;
  version: string;
  type: MediaType;
  sourceType: SourceFormat;
  downloadUrl: string;
  description?: string;
  lang?: string;
  runtime: 'javascript' | 'dart';
  compatibility: 'compatible' | 'experimental' | 'unsupported';
  installable: boolean;
  limitation?: string;
  metadata?: Record<string, unknown>;
}

interface Provider {
  id: string;
  sourceType: SourceFormat;
  url: string;
  type: MediaType;
}

interface CatalogSnapshot {
  checkedAt: string;
  groups: { id: string; commit: string; items: Record<string, unknown>[] }[];
}

const snapshot: CatalogSnapshot = require('./catalog-snapshot.json');
const RAW = 'https://raw.githubusercontent.com/';
const TIMEOUT_MS = 8000;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const providers: Provider[] = [
  { id: 'kazumi', sourceType: 'kazumi', type: 'anime', url: `${RAW}Predidit/KazumiRules/main/index.json` },
  { id: 'venera', sourceType: 'venera', type: 'manga', url: `${RAW}venera-app/venera-configs/main/index.json` },
  { id: 'mangayomi-manga', sourceType: 'mangayomi', type: 'manga', url: `${RAW}kodjodevf/mangayomi-extensions/main/index.json` },
  { id: 'mangayomi-novel', sourceType: 'mangayomi', type: 'novel', url: `${RAW}kodjodevf/mangayomi-extensions/main/novel_index.json` },
  { id: 'lnreader', sourceType: 'lnreader', type: 'novel', url: `${RAW}LNReader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json` },
];

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function httpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('来源下载地址必须为 HTTPS。');
  return url.href;
}

export function normalizeCatalog(sourceType: SourceFormat, value: unknown, type: MediaType): MarketPlugin[] {
  if (!Array.isArray(value)) throw new Error('来源目录格式错误。');
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('来源条目格式错误。');
    const item = entry as Record<string, unknown>;
    const name = text(item.name);
    if (!name) throw new Error('来源缺少名称。');
    const version = text(item.version) || '1.0.0';
    const base = { name, version, type, sourceType, runtime: 'javascript' as const, installable: true };
    if (sourceType === 'kazumi') {
      const slug = name.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'imported-rule';
      return { ...base, id: `kazumi-${slug}`, compatibility: 'compatible' as const,
        downloadUrl: `${RAW}Predidit/KazumiRules/main/${encodeURIComponent(name)}.json`,
        description: '支持 XPath 与 JSON API 规则；播放可用性以实际站点为准。' };
    }
    if (sourceType === 'venera') {
      const filename = text(item.fileName) || text(item.filename);
      const key = text(item.key) || filename.replace(/\.js$/, '');
      if (!key || (!filename && !text(item.url))) throw new Error('Venera 来源缺少文件地址。');
      return { ...base, id: `venera-${key}`, compatibility: 'experimental' as const,
        downloadUrl: httpsUrl(text(item.url) || `${RAW}venera-app/venera-configs/main/${filename}`),
        description: text(item.description) || '漫画来源；部分站点需要账号或来源设置。',
        limitation: '实验兼容，尚未逐站验证阅读。' };
    }
    const sourceId = text(item.id);
    if (!sourceId) throw new Error('来源缺少 ID。');
    if (sourceType === 'mangayomi') {
      const downloadUrl = httpsUrl(text(item.sourceCodeUrl));
      const runtime = item.sourceCodeLanguage === 1 && new URL(downloadUrl).pathname.endsWith('.js') ? 'javascript' as const : 'dart' as const;
      return { ...base, id: `mangayomi-${type}-${sourceId}`, downloadUrl, runtime,
        lang: text(item.lang), metadata: item, installable: runtime === 'javascript',
        compatibility: runtime === 'javascript' ? 'experimental' as const : 'unsupported' as const,
        description: text(item.notes) || 'Mangayomi 官方归档目录中的来源。',
        limitation: runtime === 'dart' ? '需要 Dart 来源运行时，当前桌面端尚不支持。' : '实验兼容；部分宿主接口、账号或站点配置尚未支持。' };
    }
    return { ...base, id: `lnreader-${sourceId}`, compatibility: 'experimental' as const,
      downloadUrl: httpsUrl(text(item.url)), lang: text(item.lang), description: text(item.site) || '小说阅读源。',
      limitation: '实验兼容，尚未逐站验证阅读。' };
  });
}

async function fetchIndex(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let releaseReader: (() => Promise<void>) | undefined;
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    if (!response.body) throw new Error('来源目录响应为空。');
    const reader = response.body.getReader();
    releaseReader = async () => { await reader.cancel().catch(() => {}); reader.releaseLock(); };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INDEX_BYTES) throw new Error('来源目录超过大小限制。');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    clearTimeout(timer);
    await releaseReader?.();
  }
}

export interface MarketCatalog {
  sources: MarketPlugin[];
  providers: { id: string; indexUrl: string; status: 'live' | 'bundled' | 'error'; count: number; checkedAt: string; revision?: string; error?: string }[];
}

export async function loadMarketCatalog(): Promise<MarketCatalog> {
  const results = await Promise.all(providers.map(async provider => {
    try {
      const sources = normalizeCatalog(provider.sourceType, await fetchIndex(provider.url), provider.type);
      return { sources, provider: { id: provider.id, indexUrl: provider.url, status: 'live' as const, count: sources.length, checkedAt: new Date().toISOString() } };
    } catch (error) {
      const bundled = snapshot.groups.find(group => group.id === provider.id);
      const sources = bundled ? normalizeCatalog(provider.sourceType, bundled.items, provider.type) : [];
      return { sources, provider: { id: provider.id, indexUrl: provider.url, status: bundled ? 'bundled' as const : 'error' as const,
        count: sources.length, checkedAt: bundled ? snapshot.checkedAt : new Date().toISOString(), revision: bundled?.commit,
        error: error instanceof Error ? error.message : '远程目录请求失败。' } };
    }
  }));
  return { sources: results.flatMap(result => result.sources), providers: results.map(result => result.provider) };
}
