interface SourceVersion {
  id: string;
  name: string;
  type?: string;
  types?: string[];
  sourceType?: string;
  lang?: string;
}

export function groupSourceVersions<T extends SourceVersion>(sources: T[]): { key: string; name: string; versions: T[] }[] {
  const groups = new Map<string, { key: string; name: string; versions: T[] }>();
  for (const source of sources) {
    const mediaKey = source.type || [...(source.types ?? [])].sort().join(',');
    const key = `${mediaKey}:${source.name.trim().toLowerCase()}`;
    const group = groups.get(key) ?? { key, name: source.name.trim(), versions: [] };
    group.versions.push(source);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function sourceVersionLabel(source: SourceVersion): string {
  const languages: Record<string, string> = { zh: '简中', 'zh-hk': '繁中', en: '英语', all: '多语言' };
  const ecosystems: Record<string, string> = { builtin: '内置', custom: '自定义', venera: 'Venera', mangayomi: 'Mangayomi', kazumi: 'Kazumi', lnreader: 'LNReader' };
  return [ecosystems[source.sourceType || 'custom'] || source.sourceType, source.lang ? languages[source.lang] || source.lang : undefined].filter(Boolean).join(' · ');
}
