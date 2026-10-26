import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import ts from 'typescript';

interface ValidatingProxy {
  url: string;
  close(): Promise<void>;
}
type StartValidatingProxy = (resolve: (hostname: string) => Promise<string | null>) => Promise<ValidatingProxy>;

const repoRoot = path.resolve(__dirname, '../../../..');
const validatingProxyModule = path.join(repoRoot, 'server', 'src', 'plugins', 'validating-proxy.ts');
const electronBinary: string = createRequire(__filename)('electron');
const allowedHosts = new Set(['site-fixture.example', 'player-fixture.example', 'ads-fixture.example']);

function ancestorNodeModules(dir: string): string[] {
  const found: string[] = [];
  for (let current = dir; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'node_modules'))) found.push(current);
    if (path.dirname(current) === current) return found;
  }
}

function isolatedDir(prefix: string): string {
  for (const base of [os.tmpdir(), path.parse(os.tmpdir()).root, path.parse(repoRoot).root]) {
    const rel = path.relative(repoRoot, base);
    if ((rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) || ancestorNodeModules(base).length) continue;
    try {
      return fs.mkdtempSync(path.join(base, prefix));
    } catch {}
  }
  throw new Error('No writable isolated temp base');
}

const HARNESS = `
const { app, BrowserWindow } = require('electron');
const { ElectronSniffer } = require('./sniffer.js');
const { port, proxyUrl } = JSON.parse(process.env.SNIFF_FIXTURE);
const origin = name => 'http://' + name + '-fixture.example:' + port;
const settle = async (name, run) => {
  const started = Date.now();
  try { return { name, ok: true, value: await run(), ms: Date.now() - started }; }
  catch (error) { return { name, ok: false, error: String(error && error.message || error), ms: Date.now() - started }; }
};
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const results = [];
  results.push(await settle('episode', () => ElectronSniffer.sniff(origin('site') + '/play/ep2.html', { 'User-Agent': 'TitanhubFixture/1', Referer: origin('site') + '/detail' }, 15000, { proxyUrl })));
  results.push(await settle('deniedPage', () => ElectronSniffer.sniff(origin('private') + '/play/ep2.html', {}, 15000, { proxyUrl })));
  results.push(await settle('rawFakeIp', () => ElectronSniffer.sniff('http://198.18.0.28/play.html', {}, 15000, { proxyUrl })));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 700);
  results.push(await settle('cancel', () => ElectronSniffer.sniff(origin('site') + '/slow.html?c', {}, 15000, { proxyUrl, signal: controller.signal })));
  results.push(await settle('timeout', () => ElectronSniffer.sniff(origin('site') + '/slow.html?t', {}, 1500, { proxyUrl })));
  await new Promise(r => setTimeout(r, 300));
  results.push({ name: 'windows', value: BrowserWindow.getAllWindows().length });
  process.stdout.write('RESULT:' + JSON.stringify(results) + '\\n');
  app.exit(0);
});
`;

describe('ElectronSniffer in a real Electron runtime through the validating proxy', () => {
  let originServer: http.Server;
  let proxy: ValidatingProxy;
  let port = 0;
  let workDir = '';
  const hits: Array<{ host: string; url: string; ua: string; referer: string }> = [];

  beforeAll(async () => {
    originServer = http.createServer((req, res) => {
      hits.push({ host: String(req.headers.host), url: String(req.url), ua: String(req.headers['user-agent']), referer: String(req.headers.referer || '') });
      const base = (name: string) => `http://${name}-fixture.example:${port}`;
      if (req.url === '/play/ep2.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<img src="${base('ads')}/poster.jpg"><iframe src="${base('player')}/player.html?ep=2"></iframe>`);
      } else if (req.url === '/player.html?ep=2') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<script>
          fetch('${base('ads')}/preroll.mp4').catch(() => {});
          fetch('/hls/ep2/audio.m4s').catch(() => {});
          fetch('http://private-fixture.example:${port}/hls/secret.m3u8').catch(() => {});
          fetch('/redirect-private').catch(() => {});
          setTimeout(() => fetch('/hls/ep2/index.m3u8'), 400);
        </script>`);
      } else if (req.url === '/hls/ep2/index.m3u8') {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n#EXTINF:4,\nseg0.ts\n#EXT-X-ENDLIST');
      } else if (req.url === '/preroll.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4' });
        res.end('ad');
      } else if (req.url === '/hls/ep2/audio.m4s') {
        res.writeHead(200, { 'content-type': 'video/iso.segment' });
        res.end('a');
      } else if (req.url === '/redirect-private') {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/secret` });
        res.end();
      } else if (req.url?.startsWith('/slow.html')) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<p>no media</p>');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>(resolve => originServer.listen(0, '127.0.0.1', () => resolve()));
    port = (originServer.address() as { port: number }).port;
    const { startValidatingProxy } = (await import(validatingProxyModule)) as { startValidatingProxy: StartValidatingProxy };
    proxy = await startValidatingProxy(async hostname => (allowedHosts.has(hostname) ? '127.0.0.1' : null));

    workDir = isolatedDir('titanhub-native-sniff-');
    const source = fs.readFileSync(path.join(__dirname, 'sniffer.ts'), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
    fs.writeFileSync(path.join(workDir, 'sniffer.js'), output.outputText);
    fs.writeFileSync(path.join(workDir, 'main.js'), HARNESS);
    fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({ name: 'native-sniff-harness', main: 'main.js' }));
  });

  afterAll(async () => {
    await proxy?.close();
    await new Promise<void>(resolve => originServer.close(() => resolve()));
    if (workDir && path.basename(workDir).startsWith('titanhub-native-sniff-')) fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('captures the selected episode manifest, rejects private targets, cancels, times out and leaves no windows', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of ['NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'HTTP_PROXY', 'HTTPS_PROXY', 'PROXY_URL', 'http_proxy', 'https_proxy']) delete env[name];
    env.SNIFF_FIXTURE = JSON.stringify({ proxyUrl: proxy.url, port });

    const child = spawn(electronBinary, [workDir, `--user-data-dir=${path.join(workDir, 'profile')}`], { cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
    const line = stdout.split('\n').find(entry => entry.startsWith('RESULT:'));
    expect(line, `code=${code} stdout=${stdout}\nstderr=${stderr}`).toBeTruthy();
    expect(code).toBe(0);
    const results = Object.fromEntries(JSON.parse(line!.slice(7)).map((entry: any) => [entry.name, entry]));

    expect(results.episode).toMatchObject({ ok: true, value: `http://player-fixture.example:${port}/hls/ep2/index.m3u8` });
    expect(results.deniedPage.ok).toBe(false);
    expect(results.deniedPage.ms).toBeLessThan(10000);
    expect(results.rawFakeIp).toMatchObject({ ok: false, error: expect.stringMatching(/SecurityError/) });
    expect(results.cancel).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) });
    expect(results.cancel.ms).toBeLessThan(5000);
    expect(results.timeout).toMatchObject({ ok: false, error: expect.stringMatching(/timed out/) });
    expect(results.windows.value).toBe(0);

    const page = hits.find(hit => hit.url === '/play/ep2.html' && hit.host.startsWith('site-fixture.example'));
    expect(page).toMatchObject({ ua: 'TitanhubFixture/1', referer: `http://site-fixture.example:${port}/detail` });
    expect(hits.some(hit => hit.host.startsWith('private-fixture.example'))).toBe(false);
    expect(hits.some(hit => hit.url === '/secret')).toBe(false);
    expect(hits.some(hit => hit.url === '/hls/ep2/index.m3u8' && hit.host.startsWith('player-fixture.example'))).toBe(true);
  }, 90000);
});
