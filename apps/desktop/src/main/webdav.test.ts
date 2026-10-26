import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { WebDavSettings, requestWebDav } from './webdav';

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('fs', () => ({ default: {
  existsSync: (file: string) => disk.has(file),
  readFileSync: (file: string) => disk.get(file),
  mkdirSync: vi.fn(),
  writeFileSync: (file: string, data: string) => disk.set(file, data),
  renameSync: (from: string, to: string) => { disk.set(to, disk.get(from)!); disk.delete(from); },
} }));

describe('encrypted desktop WebDAV settings', () => {
  const codec = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`).reverse(),
    decryptString: (value: Buffer) => Buffer.from(value).reverse().toString().slice('encrypted:'.length),
  };
  const input = { url: 'https://dav.example/collection/', username: 'reader', password: 'private-password', allowInsecureHttp: false };
  beforeEach(() => disk.clear());

  it('persists ciphertext and exposes no password on read or save', () => {
    const settings = new WebDavSettings('/test-profile', codec);
    expect(settings.read()).toEqual({ url: '', username: '', allowInsecureHttp: false, hasPassword: false });
    expect(settings.save(input)).toEqual({ url: input.url, username: input.username, allowInsecureHttp: false, hasPassword: true });
    expect([...disk.values()].join('')).not.toContain(input.password);
    expect(new WebDavSettings('/test-profile', codec).read()).not.toHaveProperty('password');
    expect(settings.getCredentials()).toEqual(input);
  });

  it('keeps the encrypted previous password when the UI leaves it blank', () => {
    const settings = new WebDavSettings('/test-profile', codec);
    settings.save(input);
    settings.save({ ...input, password: '' });
    expect(settings.getCredentials().password).toBe(input.password);
    settings.save({ url: input.url, username: input.username, allowInsecureHttp: false });
    expect(settings.getCredentials().password).toBe(input.password);
  });

  it('never reuses an old password after the server or account changes', () => {
    const settings = new WebDavSettings('/test-profile', codec);
    settings.save(input);
    for (const changed of [
      { url: 'https://other.example/', username: input.username, allowInsecureHttp: false },
      { url: input.url, username: 'other-account', allowInsecureHttp: false, password: '' },
    ]) {
      expect(() => settings.save(changed)).toThrow(/重新输入密码/);
      expect(settings.getCredentials()).toEqual(input);
    }
    settings.save({ ...input, url: 'https://other.example/', password: 'replacement' });
    expect(settings.getCredentials().password).toBe('replacement');
  });

  it('refuses persistence without OS encryption and leaves old data intact', () => {
    const settings = new WebDavSettings('/test-profile', codec);
    settings.save(input);
    const previous = [...disk.entries()];
    const unavailable = new WebDavSettings('/test-profile', { ...codec, isEncryptionAvailable: () => false });
    expect(() => unavailable.save(input)).toThrow(/加密/);
    expect([...disk.entries()]).toEqual(previous);
  });

  it('requires explicit insecure HTTP consent and rejects embedded credentials or malformed inputs', () => {
    const settings = new WebDavSettings('/test-profile', codec);
    expect(() => settings.save({ ...input, url: 'http://dav.example/' })).toThrow();
    expect(settings.save({ ...input, url: 'http://dav.example/', allowInsecureHttp: true }).allowInsecureHttp).toBe(true);
    for (const value of [null, {}, { ...input, url: 'https://user:secret@dav.example/' }, { ...input, url: 'file:///tmp' }, { ...input, password: 123 }]) {
      expect(() => settings.save(value)).toThrow();
    }
  });
});

describe('private WebDAV child transport', () => {
  function child() {
    return Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_data, callback) => callback?.(null)) });
  }
  const config = { url: 'https://dav.example/', username: 'reader', password: 'secret', allowInsecureHttp: false };

  it('matches request ids, strips unapproved result fields, and cleans listeners', async () => {
    const process = child();
    const promise = requestWebDav(process, 'webdav:test', config, 1000);
    const sent = process.send.mock.calls[0][0];
    expect(sent).toMatchObject({ type: 'webdav:test', config });
    process.emit('message', { type: 'webdav:result', id: 'other', success: true });
    process.emit('message', { type: 'webdav:result', id: sent.id, success: true, data: { success: true, password: 'secret', config, warnings: [] } });
    expect(await promise).toEqual({ success: true, warnings: [] });
    expect(process.listenerCount('message')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });

  it('rejects failures without echoing credentials from backend errors', async () => {
    const process = child();
    const promise = requestWebDav(process, 'webdav:sync', config, 1000);
    const sent = process.send.mock.calls[0][0];
    process.emit('message', { type: 'webdav:result', id: sent.id, success: false, error: 'secret https://dav.example/' });
    await expect(promise).rejects.toThrow('WebDAV');
    await expect(promise).rejects.not.toThrow('secret');
  });

  it('returns sync status while removing credential-bearing warnings and extra fields', async () => {
    const process = child();
    const promise = requestWebDav(process, 'webdav:sync', config, 1000);
    const sent = process.send.mock.calls[0][0];
    process.emit('message', { type: 'webdav:result', id: sent.id, success: true, data: {
      lastSuccessAt: '2026-10-23T12:00:00.000Z', pendingChanges: false,
      warnings: ['remote error includes secret'], config,
    } });
    const result = await promise;
    expect(result).toMatchObject({ lastSuccessAt: '2026-10-23T12:00:00.000Z', pendingChanges: false });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).not.toHaveProperty('config');
  });

  it('rejects process errors, disconnects, thrown sends, and malformed success responses', async () => {
    for (const event of ['error', 'disconnect']) {
      const process = child();
      const promise = requestWebDav(process, 'webdav:test', config, 1000);
      process.emit(event, new Error('secret'));
      await expect(promise).rejects.toThrow();
      expect(process.listenerCount('message')).toBe(0);
    }
    const throwing = child();
    throwing.send.mockImplementation(() => { throw new Error('secret'); });
    await expect(requestWebDav(throwing, 'webdav:test', config, 1000)).rejects.toThrow();
    const malformed = child();
    const promise = requestWebDav(malformed, 'webdav:sync', config, 1000);
    const sent = malformed.send.mock.calls[0][0];
    malformed.emit('message', { type: 'webdav:result', id: sent.id, success: true, data: config });
    await expect(promise).rejects.toThrow();
  });

  it('rejects timeout, process exit, send error, and disconnected backends', async () => {
    const timeoutChild = child();
    await expect(requestWebDav(timeoutChild, 'webdav:test', config, 1)).rejects.toThrow(/超时/);
    expect(timeoutChild.listenerCount('message')).toBe(0);
    const exited = child();
    const waiting = requestWebDav(exited, 'webdav:sync', config, 1000);
    exited.emit('exit', 1);
    await expect(waiting).rejects.toThrow();
    const failed = child();
    failed.send.mockImplementation((_data, callback) => callback(new Error('secret')));
    await expect(requestWebDav(failed, 'webdav:sync', config, 1000)).rejects.toThrow();
    await expect(requestWebDav(null, 'webdav:sync', config, 1000)).rejects.toThrow();
  });
});
