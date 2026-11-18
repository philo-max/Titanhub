import { describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => [] as any[]);

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = { setWindowOpenHandler: vi.fn() };
    constructor(options: unknown) {
      created.push(options);
    }
    once = vi.fn();
    loadURL = vi.fn(async () => {});
  },
  shell: { openExternal: vi.fn() },
}));

import { createMainWindow } from './window';

describe('createMainWindow', () => {
  it('lets the app window start playback without a user gesture', () => {
    createMainWindow('http://127.0.0.1:3000', 'http://127.0.0.1:3001');
    expect(created[0].webPreferences).toMatchObject({ autoplayPolicy: 'no-user-gesture-required', sandbox: true, contextIsolation: true });
  });
});
