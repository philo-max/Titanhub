export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_RECORDS = 20000;
export interface Version { counter: number; deviceId: string }
export interface SyncRecord {
  kind: 'favorite' | 'progress';
  key: string;
  mediaType: string;
  pluginId: string;
  mediaId: string;
  version: Version;
  updatedAt: string;
  isDeleted?: boolean;
  chapterId?: string;
  chapterNo?: number;
  progress?: number;
  position?: number | null;
  status?: string;
}
export interface Snapshot { schemaVersion: 1; deviceId: string; generation: number; records: SyncRecord[] }
export function mediaKey(item: { mediaType: string; pluginId: string; mediaId: string }): string {
  return JSON.stringify([item.mediaType, item.pluginId, item.mediaId]);
}
function string(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid string');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid integer');
  return value;
}
function number(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('Invalid number');
  return value;
}
export function normalizeRecord(value: unknown): SyncRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid record');
  const r = value as SyncRecord;
  if (!r.version || !['favorite', 'progress'].includes(r.kind)) throw new Error('Invalid record kind/version');
  const result: SyncRecord = {
    kind: r.kind, key: string(r.key), mediaType: string(r.mediaType), pluginId: string(r.pluginId),
    mediaId: string(r.mediaId), version: { counter: integer(r.version.counter), deviceId: string(r.version.deviceId) },
    updatedAt: string(r.updatedAt),
  };
  if (!result.version.deviceId || result.key !== mediaKey(result)) throw new Error('Invalid media key/device');
  if (r.kind === 'favorite') {
    if (typeof r.isDeleted !== 'boolean') throw new Error('Invalid tombstone');
    result.isDeleted = r.isDeleted;
  } else {
    result.chapterId = string(r.chapterId);
    result.chapterNo = integer(r.chapterNo);
    result.progress = number(r.progress, 1);
    result.position = r.position === null ? null : number(r.position);
    if (r.mediaType === 'novel' && result.position !== null) number(result.position, 1);
    if (r.mediaType === 'manga' && result.position !== null) integer(result.position);
    result.status = string(r.status);
  }
  return result;
}
export function compareVersions(a: Version, b: Version): number {
  return a.counter === b.counter ? Buffer.compare(Buffer.from(a.deviceId), Buffer.from(b.deviceId)) : a.counter - b.counter;
}
export function mergeRecords(...groups: SyncRecord[][]): SyncRecord[] {
  const map = new Map<string, SyncRecord>();
  for (const group of groups) for (const value of group) {
    const record = normalizeRecord(value);
    const key = JSON.stringify([record.kind, record.key]);
    const old = map.get(key);
    const comparison = old ? compareVersions(record.version, old.version) : 1;
    if (comparison === 0 && JSON.stringify(record) !== JSON.stringify(old)) throw new Error('Conflicting equal versions');
    if (comparison > 0) map.set(key, record);
  }
  if (map.size > MAX_RECORDS) throw new Error('Too many records');
  return [...map.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, record]) => record);
}
export function parseSnapshot(bytes: string): Snapshot {
  if (Buffer.byteLength(bytes) > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot too large');
  const value = JSON.parse(bytes) as Snapshot;
  if (value.schemaVersion !== 1 || !Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw new Error('Invalid snapshot schema');
  const deviceId = string(value.deviceId);
  if (!deviceId) throw new Error('Invalid snapshot device');
  return { schemaVersion: 1, deviceId, generation: integer(value.generation), records: mergeRecords(value.records) };
}
