import { describe, expect, it } from 'vitest';
import { mergeRecords, parseSnapshot, type SyncRecord } from './protocol';

const record = (counter: number, deviceId = 'a', isDeleted = false): SyncRecord => ({
  kind: 'favorite', key: '["anime","p","m"]', mediaType: 'anime', pluginId: 'p', mediaId: 'm',
  version: { counter, deviceId }, updatedAt: '2026-01-01', isDeleted,
});

describe('sync protocol', () => {
  it('is commutative, associative and idempotent including tombstones', () => {
    const a = [record(1)], b = [record(2, 'b', true)], c = [record(3)];
    expect(mergeRecords(a, b)).toEqual(mergeRecords(b, a));
    expect(mergeRecords(mergeRecords(a, b), c)).toEqual(mergeRecords(a, mergeRecords(b, c)));
    expect(mergeRecords(b, b)).toEqual(b);
    expect(mergeRecords(a, b)[0].isDeleted).toBe(true);
    expect(mergeRecords(b, c)[0].isDeleted).toBe(false);
  });
  it('compares canonical content and rejects conflicting equal versions', () => {
    expect(mergeRecords([record(1)], [JSON.parse(JSON.stringify(record(1)))] )).toHaveLength(1);
    expect(() => mergeRecords([record(1)], [record(1, 'a', true)])).toThrow('Conflicting');
    const reversed = Object.fromEntries(Object.entries(record(1)).reverse());
    expect(mergeRecords([record(1)], [reversed as unknown as SyncRecord])).toEqual([record(1)]);
  });
  it('uses version order despite wall clock skew and permits restarting progress', () => {
    const progress: SyncRecord = { ...record(1), kind: 'progress', chapterId: 'c', chapterNo: 1,
      progress: .9, position: 90, status: 'watching', updatedAt: '2099-01-01' };
    delete progress.isDeleted;
    const replay = { ...progress, version: { counter: 2, deviceId: 'b' }, progress: .1, position: 10, updatedAt: '2000-01-01' };
    expect(mergeRecords([progress], [replay])).toEqual([replay]);
    const equivalent = JSON.parse(JSON.stringify(progress).replace('"chapterNo":1', '"chapterNo":1.0'));
    expect(mergeRecords([progress], [equivalent])).toEqual([progress]);
    expect(() => mergeRecords([{ ...progress, position: NaN }])).toThrow();
    expect(() => mergeRecords([{ ...progress, progress: 2 }])).toThrow();
  });
  it('preserves unicode code points and delimiter characters in identity', () => {
    const a = { ...record(1), mediaId: 'é|x', key: '["anime","p","é|x"]' };
    const b = { ...record(1), mediaId: 'e\u0301|x', key: '["anime","p","é|x"]' };
    expect(mergeRecords([a], [b])).toHaveLength(2);
  });
  it('rejects unknown schemas, unsafe counters and inconsistent keys', () => {
    const snapshot = { schemaVersion: 1, deviceId: 'a', generation: 1, records: [record(1)] };
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(() => parseSnapshot(JSON.stringify({ ...snapshot, schemaVersion: 2 }))).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ ...snapshot, records: [record(Number.MAX_SAFE_INTEGER + 1)] }))).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ ...snapshot, records: [{ ...record(1), key: 'bad' }] }))).toThrow();
  });
});
