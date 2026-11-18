import type { SourceInfo } from '@titanhub/plugin-types';
import { normalizeCatalog, type SourceFormat } from './catalog';

interface SourcePlugin {
  id: string;
  name: string;
  code?: string;
  isBuiltin?: boolean;
}

const METADATA_LINE = /^globalThis\.__titanhubSourceMetadata = (\{[^\n]*\});\r?\n/;
const ECOSYSTEMS = ['builtin', 'custom', 'kazumi', 'venera', 'mangayomi', 'lnreader'];
const LABELS = { builtin: '内置', custom: '自定义', kazumi: 'Kazumi', venera: 'Venera', mangayomi: 'Mangayomi', lnreader: 'LNReader' };
let catalogIdentities: Map<string, SourceInfo> | undefined;

function bundledIdentity(id: string): SourceInfo | undefined {
  if (!catalogIdentities) {
    catalogIdentities = new Map();
    const snapshot = require('./catalog-snapshot.json');
    for (const group of snapshot.groups) {
      const ecosystem = group.id.split('-')[0] as SourceFormat;
      const type = group.id.includes('novel') || ecosystem === 'lnreader' ? 'novel' : ecosystem === 'kazumi' ? 'anime' : 'manga';
      for (const source of normalizeCatalog(ecosystem, group.items, type)) {
        catalogIdentities.set(source.id, { ecosystem, lang: source.lang || undefined, compatibility: source.compatibility });
      }
    }
  }
  return catalogIdentities.get(id);
}

function embeddedIdentity(code: string): SourceInfo | undefined {
  const match = METADATA_LINE.exec(code);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]);
    if (!ECOSYSTEMS.includes(value.ecosystem)) return undefined;
    return {
      ecosystem: value.ecosystem,
      ...(typeof value.lang === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$|^all$/.test(value.lang) ? { lang: value.lang } : {}),
      ...(['compatible', 'experimental', 'unsupported'].includes(value.compatibility) ? { compatibility: value.compatibility } : {}),
    };
  } catch { return undefined; }
}

export function withSourceMetadata(code: string, info: SourceInfo): string {
  const metadata = { ecosystem: info.ecosystem, lang: info.lang, compatibility: info.compatibility };
  return `globalThis.__titanhubSourceMetadata = ${JSON.stringify(metadata)};\n${code.replace(METADATA_LINE, '')}`;
}

export function sourceIdentity(plugin: SourcePlugin): { sourceInfo: SourceInfo; displayName: string } {
  const wrapper = /\/\/ Wrapped (Venera|LNReader|Mangayomi)\b/.exec(plugin.code || '');
  const prefix = wrapper ? wrapper[1].toLowerCase() : plugin.id.split('-')[0];
  const fallback: SourceInfo = { ecosystem: ECOSYSTEMS.includes(prefix) ? prefix as SourceInfo['ecosystem'] : 'custom' };
  const info: SourceInfo = plugin.isBuiltin ? { ecosystem: 'builtin' } : embeddedIdentity(plugin.code || '') ?? bundledIdentity(plugin.id) ?? fallback;
  return { sourceInfo: info, displayName: [plugin.name, LABELS[info.ecosystem], info.lang].filter(Boolean).join(' · ') };
}

export function sourceConfigurationMessage(plugin: SourcePlugin, environment: Record<string, string | undefined> = process.env): string | undefined {
  if (plugin.id === 'alist' && plugin.code?.includes('globalThis.ALIST_BASE_URL') && !environment.ALIST_BASE_URL?.trim()) {
    return '此私有网盘尚未配置服务器地址，当前客户端暂无图形设置入口；配置后才能加载内容。';
  }
  if (['venera-komga', 'venera-kavita', 'venera-lanraragi'].includes(plugin.id) && /demo\.komga\.org|demo\.kavita\.org|lrr\.tvc-16\.science/.test(plugin.code || '')) {
    return '此私有服务尚未设置自己的服务器；当前客户端尚未提供来源设置入口，不会自动访问演示服务器。';
  }
  return undefined;
}
