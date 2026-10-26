import { describe, expect, it } from 'vitest';
import { createWebDavMessageHandler } from './ipc';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('desktop WebDAV IPC', () => {
  it('dispatches a private IPC request through the real desktop backend process', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-ipc-'));
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { NODE_ENV: 'test', TITANHUB_DESKTOP: '1', HOST: '127.0.0.1', PORT: '0',
        TITANHUB_LOCAL_TOKEN: crypto.randomBytes(32).toString('base64url'), TITANHUB_SQLITE_PATH: path.join(dir, 'db'), JWT_SECRET: 'ipc-test-only',
        SystemRoot: process.env.SystemRoot },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Backend IPC startup timed out')), 10000);
        child.once('error', reject);
        child.once('exit', () => { clearTimeout(timer); reject(new Error('Backend exited before startup')); });
        child.stdout!.on('data', chunk => { if (chunk.toString().includes('Server is running')) { clearTimeout(timer); resolve(); } });
      });
      const reply = once(child, 'message');
      child.send({ type: 'webdav:test', id: 'real-ipc', config: { url: 'http://localhost/', username: 'u', password: 'do-not-echo' } });
      const [message] = await reply;
      expect(message).toMatchObject({ type: 'webdav:result', id: 'real-ipc', success: false });
      expect(JSON.stringify(message)).not.toContain('do-not-echo');
    } finally {
      const exit = once(child, 'exit'); child.kill(); await exit;
    }
  }, 15000);
  it('ignores unrelated messages and rejects invalid config without echoing secrets', async () => {
    const replies: unknown[] = [];
    const handler = createWebDavMessageHandler(message => replies.push(message));
    await handler({ type: 'unknown', id: 'x' });
    expect(replies).toHaveLength(0);
    await handler({ type: 'webdav:test', id: 'x', config: { url: 'http://user:private@localhost/', username: 'u', password: 'private' } });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ type: 'webdav:result', id: 'x', success: false });
    expect(JSON.stringify(replies)).not.toContain('private');
  });
});
