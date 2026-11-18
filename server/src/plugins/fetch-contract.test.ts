import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginSandbox } from './sandbox';

vi.mock('dns/promises', () => ({ default: { lookup: vi.fn(async () => ({ address: '93.184.216.34', family: 4 })) } }));

beforeEach(() => {
  vi.stubEnv('HTTP_PROXY', ''); vi.stubEnv('HTTPS_PROXY', ''); vi.stubEnv('PROXY_URL', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('sandbox fetch contract and execution budget', () => {
  it('identifies the app for APIs that require a User-Agent while retaining source overrides', async () => {
    const transport = vi.fn(async (input: string, options: RequestInit) => new Response(options.method || input));
    vi.stubGlobal('fetch', transport);
    await new PluginSandbox(`globalThis.plugin={async search(){await fetch('https://agent-default.example/');await fetch('https://agent-custom.example/',{headers:{'user-agent':'Source/2'}});return []}}`).runMethod('search', []);
    expect(new Headers(transport.mock.calls[0][1].headers).get('user-agent')).toBe('Titanhub/1.0');
    expect(new Headers(transport.mock.calls[1][1].headers).get('user-agent')).toBe('Source/2');
  });

  it('exposes response status, case-insensitive headers, and a parsed JSON object even from cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"items":[1,2]}', { status: 201, headers: { 'X-Source': 'fixture' } })));
    const url = `https://contract.example/${crypto.randomUUID()}`;
    const code = `globalThis.plugin={async search(){const r=await fetch(${JSON.stringify(url)});return {ok:r.ok,status:r.status,header:r.headers.get('X-SOURCE'),data:await r.json()}}}`;
    const plugin = new PluginSandbox(code);
    const expected = { success: true, data: { ok: true, status: 201, header: 'fixture', data: { items: [1, 2] } } };
    expect(await plugin.runMethod('search', [])).toMatchObject(expected);
    expect(await plugin.runMethod('search', [])).toMatchObject(expected);
  });

  it('reports HTTP failures and invalid JSON faithfully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 403 })));
    const response = await new PluginSandbox(`globalThis.plugin={async search(){const r=await fetch('https://invalid-json.example/');if(r.ok)throw Error('wrong status');return r.json()}}`).runMethod('search', []);
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/JSON|Unexpected/i);
  });

  it('does not charge host network waits to the JavaScript execution budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 80));
      return new Response('ok');
    }));
    const code = `globalThis.plugin={async search(){await fetch('https://wait-a.example/');await fetch('https://wait-b.example/');let sum=0;for(let i=0;i<20000;i++)sum+=i;return 'ready'}}`;
    expect(await new PluginSandbox(code).runMethod('search', [], 50)).toMatchObject({ success: true, data: 'ready' });
  });

  it.each([false, true])('still interrupts infinite JavaScript after an asynchronous boundary: %s', async (asynchronous) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    const code = `globalThis.plugin={async search(){${asynchronous ? "await fetch('https://loop.example/');" : ''}while(true){} }}`;
    const response = await new PluginSandbox(code).runMethod('search', [], 40);
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/interrupt|execution.*budget/i);
  });
});

const abortableTransport = (delayMs = Infinity) => vi.fn((_input: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
  const timer = Number.isFinite(delayMs) ? setTimeout(() => resolve(new Response('ok')), delayMs) : undefined;
  init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal!.reason ?? new Error('aborted')); }, { once: true });
}));
const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const looping = `globalThis.plugin={async search(){let n=0;for(;;){try{await fetch('https://loop-'+(n++)+'.example/'+Math.random())}catch{}}}}`;

describe('sandbox call limits beyond JavaScript execution time', () => {
  it('stops a fetch loop that swallows errors once the fetch limit is reached', async () => {
    const transport = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', transport);
    const response = await new PluginSandbox(looping).runMethod('search', [], 5000, { maxFetches: 4, wallTimeMs: 5000 });
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/fetch limit/i);
    expect(transport.mock.calls.length).toBeLessThanOrEqual(4);
    const calls = transport.mock.calls.length;
    await settle(150);
    expect(transport.mock.calls.length).toBe(calls);
  }, 5000);

  it('aborts in-flight requests and stops the script at the wall-clock limit', async () => {
    const transport = abortableTransport();
    vi.stubGlobal('fetch', transport);
    const started = Date.now();
    const response = await new PluginSandbox(looping).runMethod('search', [], 5000, { wallTimeMs: 200 });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/timed out/i);
    expect(transport.mock.calls.every(call => call[1].signal?.aborted)).toBe(true);
    const calls = transport.mock.calls.length;
    await settle(150);
    expect(transport.mock.calls.length).toBe(calls);
  }, 5000);

  it('stops a loop over slow real waits at the wall-clock limit', async () => {
    const transport = abortableTransport(40);
    vi.stubGlobal('fetch', transport);
    const response = await new PluginSandbox(looping).runMethod('search', [], 5000, { wallTimeMs: 300 });
    expect(response.error).toMatch(/timed out/i);
    const calls = transport.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    await settle(150);
    expect(transport.mock.calls.length).toBe(calls);
  }, 5000);

  it('lets ordinary slow requests finish within the limits and clears its timers', async () => {
    vi.stubGlobal('fetch', abortableTransport(120));
    const timers = () => process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length;
    await settle(200);
    const before = timers();
    const code = `globalThis.plugin={async search(){const out=[];for(let i=0;i<3;i++){const r=await fetch('https://slow-'+i+'.example/'+Math.random());out.push(await r.text())}return out}}`;
    expect(await new PluginSandbox(code).runMethod('search', [], 50, { wallTimeMs: 2000, maxFetches: 3 })).toMatchObject({ success: true, data: ['ok', 'ok', 'ok'] });
    expect(timers()).toBe(before);
  }, 5000);

  it('aborts requests left in flight when the method returns', async () => {
    const transport = abortableTransport();
    vi.stubGlobal('fetch', transport);
    const response = await new PluginSandbox(`globalThis.plugin={async search(){fetch('https://dangling.example/'+Math.random()).catch(()=>{});await 0;return 'done'}}`).runMethod('search', []);
    expect(response).toMatchObject({ success: true, data: 'done' });
    expect(transport.mock.calls.every(call => call[1].signal?.aborted)).toBe(true);
  }, 5000);

  it('aborts in-flight requests when the CPU budget interrupts a synchronous loop', async () => {
    const transport = abortableTransport();
    vi.stubGlobal('fetch', transport);
    const response = await new PluginSandbox(`globalThis.plugin={async search(){fetch('https://pending.example/'+Math.random()).catch(()=>{});await 0;while(true){}}}`).runMethod('search', [], 40);
    expect(response.error).toMatch(/interrupt|execution.*budget/i);
    expect(transport.mock.calls.every(call => call[1].signal?.aborted)).toBe(true);
  }, 5000);
});
