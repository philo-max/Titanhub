import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { isSafeUrl, PluginSandbox, resolveValidatedAddress } from './sandbox';
import { PlaywrightSniffer } from './sniffer';
import { fetchPinnedPublic, resolveFakeIpAddress } from './fake-ip-network';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), destroy: vi.fn(), agent: vi.fn() }));
vi.mock('dns/promises', () => ({ default: { lookup: mocks.lookup } }));
vi.mock('node:https', () => ({ request: (url: URL, options: any, callback: (response: any) => void) => {
  mocks.agent(options);
  const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
  request.destroy = mocks.destroy;
  request.end = () => {
    void Promise.resolve().then(() => mocks.fetch(url.href, options)).then((response: Response) => {
      const stream = response.body ? Readable.fromWeb(response.body as any) : Readable.from([]);
      Object.assign(stream, { statusCode: response.status, statusMessage: response.statusText, headers: Object.fromEntries(response.headers.entries()) });
      callback(stream);
    }).catch(error => request.emit('error', error));
  };
  return request;
} }));

const answer = (addresses = ['104.26.9.23']) => new Response(JSON.stringify({ Status: 0, Answer: addresses.map(data => ({ type: 1, data })) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HTTP_PROXY', '');
  vi.stubEnv('HTTPS_PROXY', '');
  vi.stubEnv('PROXY_URL', '');
  vi.stubGlobal('fetch', vi.fn(async () => answer()));
  mocks.lookup.mockResolvedValue({ address: '198.18.0.21', family: 4 });
  mocks.destroy.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('fake-IP network compatibility', () => {
  it('accepts a hostname with fake DNS only after trusted public DNS validation', async () => {
    expect(await isSafeUrl('https://fake-public.example/', { allowPinnedFakeIp: true })).toBe(true);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('https://cloudflare-dns.com/dns-query?'), expect.objectContaining({ redirect: 'error', headers: { accept: 'application/dns-json' } }));
    expect(await isSafeUrl('https://fake-public.example/')).toBe(false);
  });

  it.each(['198.18.0.21', '127.0.0.1', '10.0.0.1', '169.254.169.254'])('denies raw reserved IP %s', async address => {
    expect(await isSafeUrl('http://' + address + '/private')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([['10.1.2.3', false], ['104.26.9.23', true]])('retains normal DNS handling for %s', async (address, expected) => {
    mocks.lookup.mockResolvedValue({ address, family: 4 });
    expect(await isSafeUrl(`https://normal-${address}.example/`)).toBe(expected);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects mixed public/private trusted answers and malformed DNS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(['104.26.9.23', '10.1.1.1'])));
    await expect(resolveFakeIpAddress('mixed.example')).rejects.toThrow(/DNS/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"Status":0,"Answer":[]}')));
    await expect(resolveFakeIpAddress('empty.example')).rejects.toThrow(/DNS/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('failure', { status: 503 })));
    await expect(resolveFakeIpAddress('failed.example')).rejects.toThrow(/DNS/);
  });

  it('fails closed on oversized DNS response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(17000))));
    await expect(resolveFakeIpAddress('oversize.example')).rejects.toThrow(/DNS/);
  });

  it('rejects reserved and malformed address records even when mixed with a public answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '104.26.9.23' }, { type: 28, data: 'fd01::1' }] }))));
    await expect(resolveFakeIpAddress('private-ipv6.example')).rejects.toThrow(/DNS/);
    vi.stubGlobal('fetch', vi.fn(async () => answer(['104.26.9.23', '198.18.0.20'])));
    await expect(resolveFakeIpAddress('fake-recursive.example')).rejects.toThrow(/DNS/);
    vi.stubGlobal('fetch', vi.fn(async () => answer(['104.26.9.23', 'not-an-address'])));
    await expect(resolveFakeIpAddress('invalid-address.example')).rejects.toThrow(/DNS/);
  });

  it('bounds trusted DNS requests and leaves no timer behind', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('request aborted')));
      })));
      const result = expect(resolveFakeIpAddress('timeout.example')).rejects.toThrow(/DNS.*aborted/);
      await vi.advanceTimersByTimeAsync(2501);
      await vi.advanceTimersByTimeAsync(2501);
      await result;
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('retries one transient resolver failure, never retries validation failures, and shares concurrent lookups', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce(answer()));
    expect(await resolveFakeIpAddress('transient.example')).toBe('104.26.9.23');
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.stubGlobal('fetch', vi.fn(async () => answer(['10.0.0.9'])));
    await expect(resolveFakeIpAddress('private-answer.example')).rejects.toThrow(/non-public/);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ Status: 2 }))));
    await expect(resolveFakeIpAddress('servfail.example')).rejects.toThrow(/Invalid public DNS/);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', vi.fn(async () => answer()));
    const [first, second] = await Promise.all([resolveFakeIpAddress('shared.example'), resolveFakeIpAddress('shared.example')]);
    expect([first, second]).toEqual(['104.26.9.23', '104.26.9.23']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('revalidates redirect targets and blocks loopback before a second request', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    const sandbox = new PluginSandbox('fake-ip-redirect', 'globalThis.plugin = { async explore() { await fetch("https://redirect-public.example/start"); return []; } };');
    const result = await sandbox.runMethod('explore', ['anime']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked by sandbox policy');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('pins native transport to the validated IP and destroys it after reading', async () => {
    mocks.fetch.mockResolvedValue(new Response('actual result'));
    const response = await fetchPinnedPublic('https://api.bgm.tv/calendar', '104.26.9.23', { headers: { host: 'private.example', 'accept-encoding': 'gzip' } });
    expect(await response.text()).toBe('actual result');
    const options = mocks.agent.mock.calls[0][0] as { lookup: (hostname: string, settings: { all: boolean }, callback: (...args: unknown[]) => void) => void };
    const callback = vi.fn();
    options.lookup('api.bgm.tv', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '104.26.9.23', family: 4 }]);
    expect(mocks.fetch).toHaveBeenCalledWith('https://api.bgm.tv/calendar', expect.objectContaining({ agent: false, lookup: expect.anything() }));
    expect(mocks.agent.mock.calls[0][0].headers).toEqual({ 'accept-encoding': 'identity' });
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('destroys failed and oversized transports and denies private pinned addresses', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('connection failed'));
    await expect(fetchPinnedPublic('https://api.bgm.tv/calendar', '104.26.9.23', {})).rejects.toThrow('connection failed');
    expect(mocks.destroy).toHaveBeenCalledOnce();
    mocks.fetch.mockResolvedValueOnce(new Response('x'.repeat(5 * 1024 * 1024 + 1)));
    await expect(fetchPinnedPublic('https://api.bgm.tv/calendar', '104.26.9.23', {})).rejects.toThrow(/limit/);
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
    await expect(fetchPinnedPublic('https://api.bgm.tv/calendar', '10.0.0.1', {})).rejects.toThrow(/public/);
    expect(mocks.agent).toHaveBeenCalledTimes(2);
  });

  it('destroys a pinned transport when its request is aborted', async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('request aborted')));
    }));
    const result = expect(fetchPinnedPublic('https://api.bgm.tv/calendar', '104.26.9.23', { signal: controller.signal })).rejects.toThrow('request aborted');
    await Promise.resolve();
    controller.abort();
    await result;
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('does not retry deterministic oversized responses', async () => {
    mocks.fetch.mockResolvedValue(new Response('x'.repeat(5 * 1024 * 1024 + 1)));
    const sandbox = new PluginSandbox('fake-ip-overlimit', 'globalThis.plugin = { async explore() { await fetch("https://overlimit-public.example/"); return []; } };');
    const result = await sandbox.runMethod('explore', ['anime']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('bytes limit');
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('hands a fake-IP play page to the validating sniffer instead of rejecting it', async () => {
    const sniff = vi.spyOn(PlaywrightSniffer, 'sniff').mockResolvedValue('https://cdn-public.example/ep1/index.m3u8');
    try {
      const sandbox = new PluginSandbox('fake-ip-sniff', 'globalThis.plugin = { async getVideoUrl(id) { return [{ quality: "默认", url: await sniffVideo("https://dmbus-fake.example/p/" + id + ".html", { Referer: "https://dmbus-fake.example/" }) }]; } };');
      const result = await sandbox.runMethod('getVideoUrl', ['6287-1-1'], 35000);
      expect(result).toEqual({ success: true, data: [{ quality: '默认', url: 'https://cdn-public.example/ep1/index.m3u8' }] });
      expect(sniff).toHaveBeenCalledWith('https://dmbus-fake.example/p/6287-1-1.html', { Referer: 'https://dmbus-fake.example/' });
    } finally {
      sniff.mockRestore();
    }
  });

  it.each([['dns-private.example', '10.0.0.5'], ['dns-metadata.example', '169.254.169.254'], ['dns-loopback.example', '127.0.0.1']])('still rejects sniffVideo for %s resolving to %s', async (host, address) => {
    mocks.lookup.mockResolvedValue({ address, family: 4 });
    const sniff = vi.spyOn(PlaywrightSniffer, 'sniff');
    try {
      const sandbox = new PluginSandbox('private-sniff', `globalThis.plugin = { async getVideoUrl() { return await sniffVideo("http://${host}/play"); } };`);
      const result = await sandbox.runMethod('getVideoUrl', ['1']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked by sandbox policy');
      expect(sniff).not.toHaveBeenCalled();
    } finally {
      sniff.mockRestore();
    }
  });

  it('resolves proxy targets only to validated public addresses', async () => {
    expect(await resolveValidatedAddress('fake-proxy.example')).toBe('104.26.9.23');
    expect(await resolveValidatedAddress('[2606:4700::6810:84e5]')).toBe('2606:4700::6810:84e5');
    for (const host of ['198.18.0.28', '127.0.0.1', '10.0.0.1', '169.254.169.254', '[::1]', 'localhost', 'intranet']) {
      expect(await resolveValidatedAddress(host)).toBeNull();
    }
    vi.stubGlobal('fetch', vi.fn(async () => answer(['10.9.9.9'])));
    expect(await resolveValidatedAddress('fake-private-answer.example')).toBeNull();
    mocks.lookup.mockResolvedValue({ address: '192.168.1.20', family: 4 });
    expect(await resolveValidatedAddress('lan.example')).toBeNull();
    mocks.lookup.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await resolveValidatedAddress('missing.example')).toBeNull();
  });

  it('fails explicitly for fake-IP plus explicit proxy instead of bypassing validation', async () => {
    vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:7890');
    await expect(fetchPinnedPublic('https://api.bgm.tv/calendar', '104.26.9.23', {})).rejects.toThrow(/proxy/i);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
