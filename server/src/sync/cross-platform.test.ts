import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersions, MAX_RECORDS, MAX_SNAPSHOT_BYTES, mediaKey, mergeRecords, parseSnapshot, type SyncRecord, type Version } from './protocol';

interface Fixture {
  constants: { maxSafeInteger: number; maxSnapshotBytes: number; maxRecords: number; maxStringLength: number };
  mediaKey: { name: string; item: { mediaType: string; pluginId: string; mediaId: string }; key: string }[];
  compareVersions: { name: string; a: Version; b: Version; sign: number }[];
  snapshots: { name: string; input: string; output: string | null }[];
  merges: { name: string; groups: SyncRecord[][]; output: string | null }[];
}

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, '../../../docs/fixtures/sync/protocol-v1-vectors.json'), 'utf8')) as Fixture;

describe('cross-platform sync vectors', () => {
  it('shares protocol constants', () => {
    expect(fixture.constants).toEqual({
      maxSafeInteger: Number.MAX_SAFE_INTEGER, maxSnapshotBytes: MAX_SNAPSHOT_BYTES, maxRecords: MAX_RECORDS, maxStringLength: 8192,
    });
  });
  it.each(fixture.mediaKey)('media key: $name', ({ item, key }) => {
    expect(mediaKey(item)).toBe(key);
  });
  it.each(fixture.compareVersions)('version order: $name', ({ a, b, sign }) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
    expect(Math.sign(compareVersions(b, a))).toBe(-sign || 0);
  });
  it.each(fixture.snapshots)('snapshot: $name', ({ input, output }) => {
    if (output === null) {
      expect(() => parseSnapshot(input)).toThrow();
    } else {
      expect(JSON.stringify(parseSnapshot(input))).toBe(output);
      expect(JSON.stringify(parseSnapshot(output))).toBe(output);
    }
  });
  it.each(fixture.merges)('merge: $name', ({ groups, output }) => {
    if (output === null) expect(() => mergeRecords(...groups)).toThrow();
    else expect(JSON.stringify(mergeRecords(...groups))).toBe(output);
  });
});
