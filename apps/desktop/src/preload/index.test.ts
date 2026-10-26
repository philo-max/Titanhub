import { describe, it, expect, vi, beforeEach } from 'vitest';

const bridge = vi.hoisted(() => ({
  exposed: null as any,
  listeners: new Map<string, (...args: any[]) => unknown>(),
  invoke: vi.fn(async () => ({ apiBase: 'http://127.0.0.1:3001', token: 't'.repeat(43) })),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: unknown) => {
      bridge.exposed = api;
    },
  },
  ipcRenderer: {
    invoke: bridge.invoke,
    send: bridge.send,
    on: (channel: string, fn: (...args: any[]) => unknown) => bridge.listeners.set(channel, fn),
  },
}));

async function triggerFlush(id: string) {
  await bridge.listeners.get('app:flush-request')!({}, id);
}

describe('desktop preload bridge', () => {
  beforeEach(async () => {
    vi.resetModules();
    bridge.listeners.clear();
    bridge.send.mockClear();
    bridge.invoke.mockClear();
    await import('./index');
  });

  it('exposes a narrow getLocalSession that goes through the validated IPC channel', async () => {
    const session = await bridge.exposed.getLocalSession();
    expect(bridge.invoke).toHaveBeenCalledWith('session:local');
    expect(session.token).toHaveLength(43);
    expect(JSON.stringify(bridge.exposed)).not.toMatch(/token|secret/i);
  });

  it('confirms flush immediately when the page registered no pending writes handler', async () => {
    await triggerFlush('r1');
    expect(bridge.send).toHaveBeenCalledWith('app:flush-result', 'r1', true);
  });

  it('reports the page flush outcome, treating errors as failure', async () => {
    bridge.exposed.setFlushHandler(async () => false);
    await triggerFlush('r2');
    expect(bridge.send).toHaveBeenLastCalledWith('app:flush-result', 'r2', false);

    bridge.exposed.setFlushHandler(async () => {
      throw new Error('disk');
    });
    await triggerFlush('r3');
    expect(bridge.send).toHaveBeenLastCalledWith('app:flush-result', 'r3', false);

    bridge.exposed.setFlushHandler(async () => true);
    await triggerFlush('r4');
    expect(bridge.send).toHaveBeenLastCalledWith('app:flush-result', 'r4', true);

    bridge.exposed.setFlushHandler(null);
    await triggerFlush('r5');
    expect(bridge.send).toHaveBeenLastCalledWith('app:flush-result', 'r5', true);
  });
});
