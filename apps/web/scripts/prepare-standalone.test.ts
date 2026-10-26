import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { prepareStandalone } = require('./prepare-standalone.cjs');

const tempRoots: string[] = [];

function makeTempRoot(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    if (path.dirname(dir) === os.tmpdir()) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeFile(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function link(target: string, at: string) {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.symlinkSync(target, at, 'junction');
}

function pnpmPackage(base: string, key: string, name: string, files: Record<string, string>) {
  const dir = path.join(base, 'node_modules/.pnpm', key, 'node_modules', name);
  for (const [file, content] of Object.entries(files)) writeFile(path.join(dir, file), content);
  return dir;
}

function buildPnpmLayout(base: string, linkBase: string) {
  const store = (key: string, name: string) => path.join(linkBase, 'node_modules/.pnpm', key, 'node_modules', name);
  pnpmPackage(base, 'next@1', 'next', {
    'package.json': '{"name":"next","main":"index.js"}',
    'index.js':
      "module.exports={styled:require('styled-jsx/package.json').version,env:require('@next/env').name,dep:require('dep').v};",
  });
  link(store('styled-jsx@5', 'styled-jsx'), path.join(base, 'node_modules/.pnpm/next@1/node_modules/styled-jsx'));
  link(store('@next+env@1', '@next/env'), path.join(base, 'node_modules/.pnpm/next@1/node_modules/@next/env'));
  link(store('dep@2', 'dep'), path.join(base, 'node_modules/.pnpm/next@1/node_modules/dep'));
  pnpmPackage(base, 'styled-jsx@5', 'styled-jsx', {
    'package.json': '{"name":"styled-jsx","version":"5.1.6"}',
  });
  pnpmPackage(base, '@next+env@1', '@next/env', {
    'package.json': '{"name":"@next/env","main":"index.js"}',
    'index.js': "module.exports={name:'@next/env'};",
  });
  pnpmPackage(base, 'dep@1', 'dep', { 'package.json': '{"name":"dep"}', 'index.js': 'module.exports={v:1};' });
  pnpmPackage(base, 'dep@2', 'dep', { 'package.json': '{"name":"dep"}', 'index.js': 'module.exports={v:2};' });
  link(store('next@1', 'next'), path.join(base, 'apps/web/node_modules/next'));
  link(store('dep@1', 'dep'), path.join(base, 'apps/web/node_modules/dep'));
}

function createNextStandaloneFixture() {
  const root = makeTempRoot('titanhub 预备 standalone-');
  const repo = path.join(root, '仓库 根');
  buildPnpmLayout(repo, repo);
  const standalone = path.join(repo, 'apps/web/.next/standalone');
  buildPnpmLayout(standalone, repo);
  writeFile(
    path.join(standalone, 'apps/web/server.js'),
    "process.stdout.write(JSON.stringify({next:require('next'),appDep:require('dep').v}));"
  );
  writeFile(path.join(standalone, 'apps/web/.next/BUILD_ID'), 'fixture');
  return { root, repo, standalone };
}

function copyDereferenced(from: string, to: string) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyDereferenced(path.join(from, name), path.join(to, name));
  } else {
    fs.copyFileSync(from, to);
  }
}

function findLinks(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (fs.lstatSync(full).isSymbolicLink()) found.push(full);
    else if (entry.isDirectory()) found.push(...findLinks(full));
  }
  return found;
}

function ancestorPackagesShadowing(dir: string, names: string[]) {
  const shadowing: string[] = [];
  let current = path.dirname(dir);
  while (true) {
    for (const name of names) {
      const candidate = path.join(current, 'node_modules', name);
      if (fs.existsSync(candidate)) shadowing.push(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) return shadowing;
    current = parent;
  }
}

function cleanEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  return env;
}

describe('prepareStandalone', () => {
  it('produces a link-free tree that still resolves after a dereferencing copy to an isolated location', () => {
    const { root, repo, standalone } = createNextStandaloneFixture();
    const output = path.join(root, 'standalone');

    prepareStandalone({ sourceDir: standalone, outputDir: output, tracingRoot: repo });

    expect(fs.readFileSync(path.join(output, 'apps/web/.next/BUILD_ID'), 'utf8')).toBe('fixture');

    const installRoot = makeTempRoot('titanhub 隔离 安装-');
    const installed = path.join(installRoot, 'resources/apps/web/standalone');
    copyDereferenced(output, installed);
    const leftoverLinks = findLinks(output);
    fs.rmSync(root, { recursive: true, force: true });
    expect(ancestorPackagesShadowing(installed, ['next', 'styled-jsx', '@next/env', 'dep'])).toEqual([]);

    const serverDir = path.join(installed, 'apps/web');
    const result = spawnSync(process.execPath, [path.join(serverDir, 'server.js')], {
      cwd: serverDir,
      env: cleanEnv(),
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      next: { styled: '5.1.6', env: '@next/env', dep: 2 },
      appDep: 1,
    });
    expect(leftoverLinks).toEqual([]);
  });

  it('rejects links that escape the tracing root', () => {
    const { root, repo, standalone } = createNextStandaloneFixture();
    const outside = makeTempRoot('titanhub outside-');
    writeFile(path.join(outside, 'evil/package.json'), '{"name":"evil"}');
    link(path.join(outside, 'evil'), path.join(standalone, 'apps/web/node_modules/evil'));

    expect(() =>
      prepareStandalone({ sourceDir: standalone, outputDir: path.join(root, 'standalone'), tracingRoot: repo })
    ).toThrow(/outside the tracing root/);
  });
});
