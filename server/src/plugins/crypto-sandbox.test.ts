import { describe, it, expect } from 'vitest';
import { PluginSandbox } from './sandbox';
import { clearPluginCookies } from './sandbox';

describe('Convert (Crypto API) in Sandbox', () => {
  it('should compute MD5 hash', async () => {
    const code = `
      const plugin = {
        async test() {
          const encoded = Convert.encodeUtf8('hello');
          const hashed = Convert.md5(encoded);
          const hex = Convert.hexEncode(hashed);
          return hex;
        }
      };
      globalThis.plugin = plugin;
    `;
    const sandbox = new PluginSandbox('crypto-test-md5', code);
    const result = await sandbox.runMethod<string>('test', []);
    expect(result.success).toBe(true);
    // MD5 of "hello" = 5d41402abc4b2a76b9719d911017c592
    expect(result.data).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('should compute SHA-256 hash', async () => {
    const code = `
      const plugin = {
        async test() {
          const encoded = Convert.encodeUtf8('hello');
          const hashed = Convert.sha256(encoded);
          const hex = Convert.hexEncode(hashed);
          return hex;
        }
      };
      globalThis.plugin = plugin;
    `;
    const sandbox = new PluginSandbox('crypto-test-sha256', code);
    const result = await sandbox.runMethod<string>('test', []);
    expect(result.success).toBe(true);
    // SHA-256 of "hello" = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(result.data).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should perform HMAC-SHA256', async () => {
    const code = `
      const plugin = {
        async test() {
          const key = Convert.encodeUtf8('secret');
          const data = Convert.encodeUtf8('message');
          const hmac = Convert.hmacString(key, data, 'sha256');
          return hmac;
        }
      };
      globalThis.plugin = plugin;
    `;
    const sandbox = new PluginSandbox('crypto-test-hmac', code);
    const result = await sandbox.runMethod<string>('test', []);
    expect(result.success).toBe(true);
    // HMAC-SHA256 of "message" with key "secret"
    expect(result.data).toHaveLength(64); // hex string of 32 bytes
  });

  it('should perform AES-128-CBC decryption', async () => {
    // Encrypt "test data" with AES-128-CBC, key=16bytes, iv=16bytes
    const crypto = require('crypto');
    const key = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([
      cipher.update('test data', 'utf8'),
      cipher.final(),
    ]);

    const code = `
      const plugin = {
        async test() {
          // Key and IV are passed as base64 strings
          const keyB64 = '${key.toString('base64')}';
          const ivB64 = '${iv.toString('base64')}';
          const encB64 = '${encrypted.toString('base64')}';
          const decrypted = Convert.decryptAesCbc(encB64, keyB64, ivB64);
          return Convert.decodeUtf8(decrypted);
        }
      };
      globalThis.plugin = plugin;
    `;
    const sandbox = new PluginSandbox('crypto-test-aes', code);
    const result = await sandbox.runMethod<string>('test', []);
    expect(result.success).toBe(true);
    expect(result.data).toBe('test data');
  });

  it('should encode and decode base64/utf8 roundtrip', async () => {
    const code = `
      const plugin = {
        async test() {
          const original = '你好世界 Hello World 123';
          const encoded = Convert.encodeUtf8(original);
          const decoded = Convert.decodeUtf8(encoded);
          return decoded;
        }
      };
      globalThis.plugin = plugin;
    `;
    const sandbox = new PluginSandbox('crypto-test-b64', code);
    const result = await sandbox.runMethod<string>('test', []);
    expect(result.success).toBe(true);
    expect(result.data).toBe('你好世界 Hello World 123');
  });
});

describe('Cookie Management in Sandbox', () => {
  it('should not crash when no cookies are present', async () => {
    clearPluginCookies('cookie-test-1');
    const code = `
      const plugin = {
        async test() {
          return 'ok';
        }
      };
      globalThis.plugin = plugin;
    `;
    const sandbox = new PluginSandbox('cookie-test-1', code);
    const result = await sandbox.runMethod<string>('test', []);
    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    clearPluginCookies('cookie-test-1');
  });
});
