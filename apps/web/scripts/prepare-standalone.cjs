const fs = require('fs');
const path = require('path');

const MAX_LINK_HOPS = 32;

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function createLinkResolver(sourceDir, tracingRoot) {
  return function resolveReal(entry) {
    let current = entry;
    for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
      if (!fs.lstatSync(current).isSymbolicLink()) return current;
      const target = path.resolve(path.dirname(current), fs.readlinkSync(current).replace(/^\\\\\?\\/, ''));
      if (isInside(sourceDir, target)) {
        current = target;
      } else if (isInside(tracingRoot, target)) {
        current = path.join(sourceDir, path.relative(tracingRoot, target));
      } else {
        throw new Error(`Link ${entry} points outside the tracing root: ${target}`);
      }
      if (!fs.existsSync(current)) throw new Error(`Link ${entry} target is missing from standalone output: ${current}`);
    }
    throw new Error(`Too many link hops while resolving ${entry}`);
  };
}

function nodeModulesChain(start, stop) {
  const chain = [];
  let current = start;
  while (true) {
    if (path.basename(current) !== 'node_modules') chain.push(path.join(current, 'node_modules'));
    if (current === stop) return chain;
    current = path.dirname(current);
  }
}

function prepareStandalone({ sourceDir, outputDir, tracingRoot }) {
  const resolveReal = createLinkResolver(sourceDir, tracingRoot);

  function copyTree(from, to) {
    const real = resolveReal(from);
    if (fs.statSync(real).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(real)) {
        if (name !== 'node_modules') copyTree(path.join(real, name), path.join(to, name));
      }
    } else {
      fs.copyFileSync(real, to);
    }
  }

  function listPackages(nodeModulesDir) {
    if (!fs.existsSync(nodeModulesDir)) return [];
    const packages = [];
    const realDir = resolveReal(nodeModulesDir);
    for (const name of fs.readdirSync(realDir)) {
      if (name.startsWith('.')) continue;
      const entry = resolveReal(path.join(realDir, name));
      if (!fs.statSync(entry).isDirectory()) continue;
      if (name.startsWith('@')) {
        for (const scoped of fs.readdirSync(entry)) {
          const scopedEntry = resolveReal(path.join(entry, scoped));
          if (fs.statSync(scopedEntry).isDirectory()) packages.push([`${name}/${scoped}`, scopedEntry]);
        }
      } else {
        packages.push([name, entry]);
      }
    }
    return packages;
  }

  function visibleDependencies(realDir) {
    const dependencies = new Map();
    for (const nodeModulesDir of nodeModulesChain(realDir, sourceDir)) {
      for (const [name, real] of listPackages(nodeModulesDir)) {
        if (!dependencies.has(name) && real !== realDir) dependencies.set(name, real);
      }
    }
    return dependencies;
  }

  const placed = new Map();
  const rootNodeModules = path.join(outputDir, 'node_modules');

  function findPlaced(ownerDest, name) {
    for (const nodeModulesDir of nodeModulesChain(ownerDest, outputDir)) {
      const candidate = path.join(nodeModulesDir, name);
      if (placed.has(candidate)) return candidate;
    }
    return null;
  }

  function install(ownerDest, ownerReal) {
    const added = [];
    for (const [name, real] of visibleDependencies(ownerReal)) {
      const existing = findPlaced(ownerDest, name);
      if (existing && placed.get(existing) === real) continue;
      const target = existing ? path.join(ownerDest, 'node_modules', name) : path.join(rootNodeModules, name);
      placed.set(target, real);
      copyTree(real, target);
      added.push([target, real]);
    }
    for (const [target, real] of added) install(target, real);
  }

  function appOwners(dir) {
    const owners = fs.existsSync(path.join(dir, 'node_modules')) ? [dir] : [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') owners.push(...appOwners(path.join(dir, entry.name)));
    }
    return owners;
  }

  copyTree(sourceDir, outputDir);
  for (const owner of appOwners(sourceDir)) {
    install(path.join(outputDir, path.relative(sourceDir, owner)), owner);
  }
}

function copyPlain(from, to) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyPlain(path.join(from, name), path.join(to, name));
  } else {
    fs.copyFileSync(from, to);
  }
}

function main() {
  const webDir = path.resolve(__dirname, '..');
  const requiredServerFiles = JSON.parse(
    fs.readFileSync(path.join(webDir, '.next/required-server-files.json'), 'utf8')
  );
  const tracingRoot = path.resolve(requiredServerFiles.config.outputFileTracingRoot);
  const sourceDir = path.join(webDir, '.next/standalone');
  const outputDir = path.join(webDir, 'standalone');
  const appOutputDir = path.join(outputDir, requiredServerFiles.relativeAppDir);

  if (path.dirname(outputDir) !== webDir || path.basename(outputDir) !== 'standalone') {
    throw new Error(`Refusing to replace unexpected output directory: ${outputDir}`);
  }
  fs.rmSync(outputDir, { recursive: true, force: true });

  prepareStandalone({ sourceDir, outputDir, tracingRoot });
  if (fs.existsSync(path.join(webDir, '.next/static'))) {
    copyPlain(path.join(webDir, '.next/static'), path.join(appOutputDir, '.next/static'));
  }
  if (fs.existsSync(path.join(webDir, 'public'))) {
    copyPlain(path.join(webDir, 'public'), path.join(appOutputDir, 'public'));
  }
}

if (require.main === module) main();

module.exports = { prepareStandalone };
