import { describe, expect, it, vi } from 'vitest';
import { installMarketSources } from './source-market';

describe('source market batch installation', () => {
  it('skips unsupported runtimes and current versions while installing new or updated sources', async () => {
    const install = vi.fn(async (_source: { id: string }) => {});
    const progress = vi.fn();
    const result = await installMarketSources([
      { id: 'dart', version: '1', installable: false },
      { id: 'current', version: '2', installable: true },
      { id: 'update', version: '2', installable: true },
      { id: 'new', version: '1', installable: true },
    ], [{ id: 'current', version: '2' }, { id: 'update', version: '1' }], install, progress);
    expect(install.mock.calls.map(([source]) => source.id)).toEqual(['update', 'new']);
    expect(result).toEqual({ succeeded: ['update', 'new'], failed: [] });
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('continues after one download fails and retains its actionable error', async () => {
    const install = vi.fn(async (source: { id: string }) => { if (source.id === 'broken') throw new Error('HTTP 404'); });
    const result = await installMarketSources([{ id: 'broken', version: '1' }, { id: 'working', version: '1' }], [], install, vi.fn());
    expect(result).toEqual({ succeeded: ['working'], failed: [{ id: 'broken', error: 'HTTP 404' }] });
  });
});
