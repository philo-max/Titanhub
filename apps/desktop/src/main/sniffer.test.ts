import { describe, it, expect } from 'vitest';
import { isSafeUrlForSniffing, isSafeUrlForSniffingAsync, isSafeHostDns, ElectronSniffer } from './sniffer';

describe('ElectronSniffer & Network Security Policies', () => {
  it('blocks dangerous loopback, private IPs, metadata and non-HTTP protocols', () => {
    // Loopback targets
    expect(isSafeUrlForSniffing('http://127.0.0.1:3001/api/auth')).toBe(false);
    expect(isSafeUrlForSniffing('http://localhost:3000/')).toBe(false);
    expect(isSafeUrlForSniffing('http://[::1]:8080/')).toBe(false);

    // Cloud metadata & link-local
    expect(isSafeUrlForSniffing('http://169.254.169.254/latest/meta-data')).toBe(false);

    // Private IP subnets
    expect(isSafeUrlForSniffing('http://192.168.1.1/admin')).toBe(false);
    expect(isSafeUrlForSniffing('http://10.0.0.5/api')).toBe(false);
    expect(isSafeUrlForSniffing('http://172.16.0.10:8000/')).toBe(false);

    // Non-HTTP/HTTPS schemes
    expect(isSafeUrlForSniffing('file:///C:/Windows/System32/drivers/etc/hosts')).toBe(false);
    expect(isSafeUrlForSniffing('javascript:alert(1)')).toBe(false);
    expect(isSafeUrlForSniffing('data:text/html,<h1>evil</h1>')).toBe(false);

    // Intranet single-label hostnames without dot
    expect(isSafeUrlForSniffing('http://router/login')).toBe(false);
    expect(isSafeUrlForSniffing('http://internal-nas/data')).toBe(false);

    // Valid public domains
    expect(isSafeUrlForSniffing('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    expect(isSafeUrlForSniffing('http://v.example.com/play?id=123')).toBe(true);
  });

  it('validates hostnames with DNS resolution against private IP destinations', async () => {
    // Loopback and local hostnames fail DNS safety check
    expect(await isSafeHostDns('localhost')).toBe(false);
    expect(await isSafeHostDns('127.0.0.1')).toBe(false);
    expect(await isSafeHostDns('internal.local')).toBe(false);

    // isSafeUrlForSniffingAsync checks DNS
    expect(await isSafeUrlForSniffingAsync('http://127.0.0.1:8080/')).toBe(false);
    expect(await isSafeUrlForSniffingAsync('http://localhost:3000/')).toBe(false);
  });

  it('rejects unsafe loopback targets immediately without opening browser window', async () => {
    await expect(
      ElectronSniffer.sniff('http://127.0.0.1:3001/admin')
    ).rejects.toThrow(/SecurityError/);
  });

  it('defers hostname resolution to the validating proxy but keeps literal private targets blocked', () => {
    expect(isSafeUrlForSniffing('https://dmbus.cc/p/6287-1-1.html', { proxied: true })).toBe(true);
    for (const url of ['http://198.18.0.28/', 'http://127.0.0.1:3001/', 'http://169.254.169.254/', 'http://10.0.0.1/', 'file:///C:/x', 'http://router/']) {
      expect(isSafeUrlForSniffing(url, { proxied: true })).toBe(false);
    }
  });

  it('only accepts a loopback validating proxy', async () => {
    expect(ElectronSniffer.isLoopbackProxy('http://127.0.0.1:52011')).toBe(true);
    for (const proxy of ['http://10.0.0.2:8080', 'http://127.0.0.1.evil.example:80', 'socks5://127.0.0.1:1080', 'http://127.0.0.1:80/path']) {
      expect(ElectronSniffer.isLoopbackProxy(proxy)).toBe(false);
    }
    await expect(ElectronSniffer.sniff('https://dmbus.cc/p/1.html', {}, 1000, { proxyUrl: 'http://10.0.0.2:8080' })).rejects.toThrow(/loopback/);
  });

  it('classifies only playable manifests and media files, not segments, audio, ads or pages', () => {
    expect(ElectronSniffer.classifyMediaResponse('https://hhjx.example/playlist/a.m3u8?sign=1', 'application/vnd.apple.mpegurl')).toBe('manifest');
    expect(ElectronSniffer.classifyMediaResponse('https://cdn.example/x/index.m3u8', 'text/plain')).toBe('manifest');
    expect(ElectronSniffer.classifyMediaResponse('https://cdn.example/v.image', 'video/mp4')).toBe('file');
    expect(ElectronSniffer.classifyMediaResponse('https://hhjx.example/?url=https%3A%2F%2Fa%2Fb.m3u8', 'text/html')).toBeNull();
    expect(ElectronSniffer.classifyMediaResponse('https://cdn.example/hls/0001.ts', 'video/mp2t')).toBeNull();
    expect(ElectronSniffer.classifyMediaResponse('https://cdn.example/seg', 'video/mp2t')).toBeNull();
    expect(ElectronSniffer.classifyMediaResponse('https://cdn.example/a/audio.m4s', 'video/iso.segment')).toBeNull();
    expect(ElectronSniffer.classifyMediaResponse('https://cdn.example/a/track.mp4', 'audio/mp4')).toBeNull();
    expect(ElectronSniffer.classifyMediaResponse('https://googleads.g.doubleclick.net/ad.mp4', 'video/mp4')).toBeNull();
  });

  it('applies plugin headers to the page load without header injection', () => {
    const options = ElectronSniffer.buildLoadOptions({ 'User-Agent': 'UA/1', Referer: 'https://dmbus.cc/', Cookie: 'a=1', Host: 'evil', 'X-Bad': 'a\r\nInjected: 1' });
    expect(options.userAgent).toBe('UA/1');
    expect(options.httpReferrer).toBe('https://dmbus.cc/');
    expect(options.extraHeaders).toBe('Cookie: a=1\n');
    expect(ElectronSniffer.buildLoadOptions({ Referer: undefined as unknown as string }).httpReferrer).toBeUndefined();
  });

  it('reports electron-chromium availability', () => {
    const availability = ElectronSniffer.checkAvailability();
    expect(availability.available).toBe(true);
    expect(availability.engine).toBe('electron-chromium');
  });
});
