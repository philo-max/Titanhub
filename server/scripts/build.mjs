import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(serverRoot, 'dist');
const importMetaUrlShim = '__titanhubImportMetaUrl';

function resolveQuickJSWasm() {
  const requireFromServer = createRequire(path.join(serverRoot, 'package.json'));
  const requireFromQuickJS = createRequire(requireFromServer.resolve('quickjs-emscripten'));
  return requireFromQuickJS.resolve('@jitl/quickjs-wasmfile-release-sync/wasm');
}

await build({
  entryPoints: [path.join(serverRoot, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(distDir, 'index.js'),
  external: ['playwright', 'playwright-extra', 'puppeteer-extra-plugin-stealth', 'pg-native'],
  loader: { '.wasm': 'file' },
  define: { 'import.meta.url': importMetaUrlShim },
  banner: { js: `var ${importMetaUrlShim} = require('url').pathToFileURL(__filename).href;` },
  logLevel: 'warning',
});

fs.cpSync(path.join(serverRoot, 'src/plugins'), path.join(distDir, 'plugins'), { recursive: true });

const sqlWasm = path.join(serverRoot, 'node_modules/sql.js/dist/sql-wasm.wasm');
if (fs.existsSync(sqlWasm)) fs.copyFileSync(sqlWasm, path.join(distDir, 'sql-wasm.wasm'));

const quickJSWasm = resolveQuickJSWasm();
fs.copyFileSync(quickJSWasm, path.join(distDir, path.basename(quickJSWasm)));
