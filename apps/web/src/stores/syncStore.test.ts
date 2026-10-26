import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncStore, TrackingLog } from './syncStore';
import { useLocalSessionStore } from './localSessionStore';
import { bindProgressFlush, flushProgress } from '@/lib/progress-flush';

const log: TrackingLog = { mediaId: 'same', pluginId: 'a', mediaType: 'manga', chapterNo: 1, chapterId: 'c', progress: 0.2, position: 2, status: 'watching' };
const ok = (data = {}) => new Response(JSON.stringify({ success: true, ...data }));

describe('local data synchronization', () => {
  beforeEach(() => {
    (globalThis as any).window = { titanhubDesktop: { isDesktop: true } };
    useLocalSessionStore.setState({ status: 'ready', session: { apiBase: 'http://127.0.0.1:3101', token: 'A'.repeat(43) } });
    useSyncStore.setState({ trackingList: [], favoritesList: [], error: null, errors: {} });
  });

  afterEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    await useSyncStore.getState().flushLocalWrites();
    vi.unstubAllGlobals();
    delete (globalThis as any).window;
  });

  it('isolates media by type and plugin and preserves positions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    await useSyncStore.getState().saveProgress(log);
    await useSyncStore.getState().saveProgress({ ...log, pluginId: 'b', position: 0 });
    await useSyncStore.getState().saveProgress({ ...log, mediaType: 'novel', position: 0.5 });
    expect(useSyncStore.getState().trackingList.map((item) => item.position)).toEqual([2, 0, 0.5]);
    await useSyncStore.getState().toggleFavorite(log);
    await useSyncStore.getState().toggleFavorite({ ...log, pluginId: 'b' });
    await useSyncStore.getState().toggleFavorite(log);
    expect(useSyncStore.getState().favoritesList).toMatchObject([{ pluginId: 'b' }]);
  });

  it('retains failed writes and confirms a successful retry before flushing', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockImplementation(async () => ok());
    vi.stubGlobal('fetch', request);
    await expect(useSyncStore.getState().saveProgress(log)).rejects.toThrow();
    expect(useSyncStore.getState().error).toBeTruthy();
    expect(useSyncStore.getState().pendingWrites).toBe(2);
    expect(await useSyncStore.getState().flushLocalWrites()).toBe(true);
    expect(useSyncStore.getState().pendingWrites).toBe(0);
    expect(request.mock.calls[1][0]).toBe('http://127.0.0.1:3101/api/sync/tracking');
  });

  it('rejects false-success pulls without discarding existing data', async () => {
    useSyncStore.setState({ trackingList: [log] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'disk failed' }))));
    await expect(useSyncStore.getState().pullTracking()).rejects.toThrow('disk failed');
    expect(useSyncStore.getState().trackingList).toEqual([log]);
  });

  it('keeps a newer edit when an earlier write finishes later', async () => {
    let finish!: (value: Response) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockImplementation(async () => ok({ tracking: [log] }));
    vi.stubGlobal('fetch', request);
    const first = useSyncStore.getState().saveProgress(log);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const second = useSyncStore.getState().saveProgress({ ...log, position: 9 });
    finish(ok({ tracking: [log] }));
    await Promise.all([first, second]);
    expect(useSyncStore.getState().trackingList[0].position).toBe(9);
    expect(await useSyncStore.getState().flushLocalWrites()).toBe(true);
  });

  it('initializes the desktop session before a cold-start pull', async () => {
    const session = { apiBase: 'http://127.0.0.1:3101', token: 'A'.repeat(43) };
    (globalThis as any).window.titanhubDesktop.getLocalSession = vi.fn(async () => session);
    useLocalSessionStore.setState({ status: 'idle', session: null });
    const request = vi.fn(async (_url: string) => ok({ tracking: [log] }));
    vi.stubGlobal('fetch', request);
    await useSyncStore.getState().pullTracking();
    expect(useSyncStore.getState().trackingList).toEqual([log]);
    expect(request.mock.calls[0][0]).toBe(`${session.apiBase}/api/sync/tracking`);
  });

  it('does not acknowledge an HTTP failure even with a success payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 500 })));
    await expect(useSyncStore.getState().toggleFavorite(log)).rejects.toThrow();
    expect(await useSyncStore.getState().flushLocalWrites()).toBe(false);
    expect(useSyncStore.getState().pendingWrites).toBe(1);
    expect(useSyncStore.getState().favoritesList).toHaveLength(1);
  });

  it('overlays edits made during a cold pull instead of replacing them', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockImplementation(async () => ok()));
    const pull = useSyncStore.getState().pullTracking();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const edit = useSyncStore.getState().saveProgress({ ...log, position: 8 });
    finish(ok({ tracking: [log] }));
    await Promise.all([pull, edit]);
    expect(useSyncStore.getState().trackingList[0].position).toBe(8);
  });

  it('keeps a failed tracking pull visible when the favorites pull succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: 'tracking unavailable' }))).mockImplementation(async () => ok({ favorites: [] })));
    const results = await Promise.allSettled([useSyncStore.getState().pullTracking(), useSyncStore.getState().pullFavorites()]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(useSyncStore.getState().error).toContain('tracking unavailable');
    vi.stubGlobal('fetch', vi.fn(async () => ok({ tracking: [log] })));
    await useSyncStore.getState().pullTracking();
    expect(useSyncStore.getState().error).toBeNull();
  });

  it('retains a progress edit if local session initialization fails before the request', async () => {
    const session = { apiBase: 'http://127.0.0.1:3101', token: 'A'.repeat(43) };
    (globalThis as any).window.titanhubDesktop.getLocalSession = vi.fn().mockRejectedValueOnce(new Error('session unavailable')).mockResolvedValue(session);
    useLocalSessionStore.setState({ status: 'idle', session: null });
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    await expect(useSyncStore.getState().saveProgress(log)).rejects.toThrow('session unavailable');
    expect(useSyncStore.getState().pendingWrites).toBe(2);
    expect(await useSyncStore.getState().flushLocalWrites()).toBe(true);
    expect(useSyncStore.getState().trackingList[0].position).toBe(2);
  });

  it('captures final progress synchronously and waits for tracking and history to drain on exit', async () => {
    const target = new EventTarget();
    const latest = { ...log, mediaType: 'anime' as const, position: 123.75, progress: 0.8 };
    const captureError = vi.fn();
    let finishFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => { finishFirst = resolve; });
    let savedTracking: TrackingLog | undefined;
    const request = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/api/sync/tracking')) {
        await firstResponse;
        savedTracking = JSON.parse(init.body as string).tracking[0];
      }
      return ok();
    });
    vi.stubGlobal('fetch', request);
    const release = bindProgressFlush(target, () => void useSyncStore.getState().saveProgress(latest).catch(captureError));
    try {
      flushProgress(target);
      expect(useSyncStore.getState().pendingWrites).toBe(2);
      let flushed = false;
      const flushing = useSyncStore.getState().flushLocalWrites().then((success) => { flushed = true; return success; });
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      expect(flushed).toBe(false);
      expect(savedTracking).toBeUndefined();
      finishFirst();
      expect(await flushing).toBe(true);
      expect(request.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:3101/api/sync/tracking', 'http://127.0.0.1:3101/api/history']);
      expect(savedTracking).toMatchObject(latest);
      expect(JSON.parse(request.mock.calls[1][1].body as string)).toMatchObject({ mediaId: latest.mediaId, pluginId: latest.pluginId, mediaType: 'anime', progress: 0.8 });
      expect(useSyncStore.getState().trackingList[0].position).toBe(123.75);
      expect(useSyncStore.getState().pendingWrites).toBe(0);
      expect(captureError).not.toHaveBeenCalled();
    } finally {
      finishFirst();
      release();
    }
  });
});
