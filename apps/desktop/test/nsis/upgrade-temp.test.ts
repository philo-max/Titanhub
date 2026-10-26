import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';

const NSIS_DIR = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis', 'nsis-3.0.4.1');
const MAKENSIS = path.join(NSIS_DIR, 'Bin', 'makensis.exe');
const FIXTURE_DIR = __dirname;
const INCLUDE_FILE = path.resolve(__dirname, '..', '..', 'build', 'installer.nsh');
const WORK_PREFIX = '.work-';
const WORK_PARENT = process.platform === 'win32' ? path.parse(os.tmpdir()).root : FIXTURE_DIR;
const LONG_TEMP_PREFIX = 'titanhub-nsis-long-temp-';
const SHORT_TEMP_PATTERN = /^[A-Za-z]:\\th-[0-9A-Fa-f]{6}$/;
const MAX_PATH = 260;
const MAX_CREATE_DIRECTORY_PATH = MAX_PATH - 13;
const LEGACY_RELATIVE_LENGTH = 208;
const PLUGINSDIR_SUFFIX_LENGTH = '\\nsXXXX.tmp\\old-install'.length;
const MARKER_NAME = 'marker.txt';
const BUSY_EXIT_CODE = 2;
const WINDIR = process.env.WINDIR || 'C:\\Windows';

const workRoot = fs.mkdtempSync(path.join(WORK_PARENT, WORK_PREFIX));
const longTemp = fs.mkdtempSync(path.join(os.tmpdir(), LONG_TEMP_PREFIX));
const mockExe = path.join(workRoot, 'mock-old-uninstaller.exe');
const harnessExe = path.join(workRoot, 'upgrade-harness.exe');
const hookExe = path.join(workRoot, 'hook-compile.exe');
const createdShortTemps = new Set<string>();
let caseCounter = 0;

function compile(script: string, outFile: string, defines: string[] = []): void {
  const result = spawnSync(
    MAKENSIS,
    ['-V2', '-WX', `-DOUT_FILE=${outFile}`, `-DINCLUDE_FILE=${INCLUDE_FILE}`, ...defines, path.join(FIXTURE_DIR, script)],
    { env: { ...process.env, NSISDIR: NSIS_DIR }, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`makensis failed for ${script}:\n${result.stdout}\n${result.stderr}`);
  }
}

function parseLog(file: string): Record<string, string> {
  const entries = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return Object.fromEntries(entries.map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

function legacyRelativeFile(targetLength: number): string {
  const segments: string[] = [];
  let length = MARKER_NAME.length + 1;
  for (let index = 0; length < targetLength - 1; index += 1) {
    const segment = `segment-${String(index).padStart(2, '0')}-node_modules`;
    const remaining = targetLength - length - 1;
    const piece = segment.slice(0, Math.max(1, Math.min(segment.length, remaining)));
    segments.push(piece);
    length += piece.length + 1;
  }
  return path.join(...segments, MARKER_NAME);
}

function makeOldInstall(): { oldDir: string; markerFile: string; relative: string } {
  caseCounter += 1;
  const oldDir = path.join(workRoot, `old${caseCounter}`);
  const sourceBudget = MAX_CREATE_DIRECTORY_PATH - oldDir.length + MARKER_NAME.length + 1;
  const relative = legacyRelativeFile(Math.min(LEGACY_RELATIVE_LENGTH, sourceBudget));
  const markerFile = path.join(oldDir, relative);
  fs.mkdirSync(path.dirname(markerFile), { recursive: true });
  fs.writeFileSync(markerFile, 'old install');
  return { oldDir, markerFile, relative };
}

function makeOutDir(): string {
  caseCounter += 1;
  const outDir = path.join(workRoot, `out${caseCounter}`);
  fs.mkdirSync(outDir);
  return outDir;
}

function envWith(temp: string, tmp: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(temp|tmp)$/i.test(key)) env[key] = value;
  }
  env.TEMP = temp;
  if (tmp !== null) env.TMP = tmp;
  return env;
}

function runHarness(args: Record<string, string>, env: NodeJS.ProcessEnv) {
  const argv = ['/S', ...Object.entries(args).map(([key, value]) => `/${key}=${value}`)];
  return spawnSync(harnessExe, argv, { env });
}

function missingDriveLetters(count: number): string[] {
  const letters: string[] = [];
  for (let code = 'Z'.charCodeAt(0); code >= 'D'.charCodeAt(0) && letters.length < count; code -= 1) {
    const letter = String.fromCharCode(code);
    if (!fs.existsSync(`${letter}:\\`)) letters.push(letter);
  }
  if (letters.length < count) throw new Error('Not enough unused drive letters for the failure fixture');
  return letters;
}

function trackShortTemp(dir: string | undefined): void {
  if (dir) {
    expect(dir).toMatch(SHORT_TEMP_PATTERN);
    createdShortTemps.add(dir);
  }
}

function removeOwnShortTemp(dir: string): void {
  if (!SHORT_TEMP_PATTERN.test(dir)) throw new Error(`Refusing to remove unexpected path: ${dir}`);
  if (fs.existsSync(dir)) fs.rmdirSync(dir);
}

function removeOwnFixture(dir: string, expectedParent: string, expectedPrefix: string): void {
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== path.resolve(expectedParent) || !path.basename(resolved).startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

describe.runIf(process.platform === 'win32')('NSIS legacy uninstall backup path length', () => {
  beforeAll(() => {
    expect(fs.existsSync(MAKENSIS)).toBe(true);
    compile('mock-old-uninstaller.nsi', mockExe);
    compile('upgrade-harness.nsi', harnessExe);
    compile('hook-compile.nsi', hookExe);
    compile('hook-compile.nsi', path.join(workRoot, 'hook-compile-uninstaller.exe'), ['-DBUILD_UNINSTALLER']);
  }, 120000);

  afterEach(() => {
    for (const dir of createdShortTemps) removeOwnShortTemp(dir);
    createdShortTemps.clear();
  });

  afterAll(() => {
    removeOwnFixture(workRoot, WORK_PARENT, WORK_PREFIX);
    removeOwnFixture(longTemp, os.tmpdir(), LONG_TEMP_PREFIX);
  });

  it('reproduces the backup Rename failure when the old uninstaller inherits a long TEMP', () => {
    const { oldDir, markerFile, relative } = makeOldInstall();
    const outDir = makeOutDir();
    const logFile = path.join(outDir, 'direct.log');
    expect(markerFile.length).toBeLessThan(MAX_PATH);
    expect(longTemp.length + PLUGINSDIR_SUFFIX_LENGTH + relative.length + 1).toBeGreaterThan(MAX_PATH);

    const result = spawnSync(mockExe, [`/LOG=${logFile}`, `/SRC=${oldDir}`], { env: envWith(longTemp, longTemp) });

    const log = parseLog(logFile);
    expect(result.status).toBe(BUSY_EXIT_CODE);
    expect(log.TEMP).toBe(longTemp);
    expect(log.BUSY).toBe(markerFile);
    expect(fs.readFileSync(markerFile, 'utf8')).toBe('old install');
  });

  it('gives the old uninstaller a short drive-root TEMP and restores the original afterwards', () => {
    const { oldDir, markerFile } = makeOldInstall();
    const outDir = makeOutDir();

    const result = runHarness(
      { MODE: 'upgrade', OLD_DIR: oldDir, FALLBACK: WINDIR, OUT: outDir, MOCK: mockExe },
      envWith(longTemp, longTemp)
    );

    const harness = parseLog(path.join(outDir, 'harness.log'));
    trackShortTemp(harness.PREPARED);
    const during = parseLog(path.join(outDir, 'during.log'));
    const after = parseLog(path.join(outDir, 'after.log'));
    expect(result.status).toBe(0);
    expect(path.parse(harness.PREPARED).root.toLowerCase()).toBe(path.parse(oldDir).root.toLowerCase());
    expect(harness.TEMP_NOW).toBe(harness.PREPARED);
    expect(harness.TMP_NOW).toBe(harness.PREPARED);
    expect(during.TEMP).toBe(harness.PREPARED);
    expect(during.TMP).toBe(harness.PREPARED);
    expect(during.PLUGINSDIR.startsWith(harness.PREPARED + path.sep)).toBe(true);
    expect(during.BUSY).toBe('0');
    expect(harness.DURING_EXIT).toBe('0');
    expect(harness.SHORT_TEMP_LEFT).toBe('no');
    expect(fs.existsSync(harness.PREPARED)).toBe(false);
    expect(after.TEMP).toBe(longTemp);
    expect(after.TMP).toBe(longTemp);
    expect(harness.AFTER_EXIT).toBe(String(BUSY_EXIT_CODE));
    expect(fs.readFileSync(markerFile, 'utf8')).toBe('old install');
  });

  it('restores TMP to unset when it was not defined before the upgrade', () => {
    const { oldDir } = makeOldInstall();
    const outDir = makeOutDir();

    const result = runHarness(
      { MODE: 'upgrade', OLD_DIR: oldDir, FALLBACK: WINDIR, OUT: outDir, MOCK: mockExe },
      envWith(longTemp, null)
    );

    const harness = parseLog(path.join(outDir, 'harness.log'));
    trackShortTemp(harness.PREPARED);
    expect(result.status).toBe(0);
    expect(parseLog(path.join(outDir, 'during.log')).TMP).toBe(harness.PREPARED);
    const after = parseLog(path.join(outDir, 'after.log'));
    expect(after.TEMP).toBe(longTemp);
    expect(after.TMP).toBe('');
  });

  it('leaves TEMP, TMP and drive roots untouched when there is no old installation', () => {
    const outDir = makeOutDir();

    const result = runHarness(
      { MODE: 'prepare-only', OLD_DIR: '', FALLBACK: WINDIR, OUT: outDir },
      envWith(longTemp, longTemp)
    );

    const harness = parseLog(path.join(outDir, 'harness.log'));
    expect(result.status).toBe(0);
    expect(harness.PREPARED).toBe('');
    expect(harness.TEMP_NOW).toBe(longTemp);
    expect(harness.TMP_NOW).toBe(longTemp);
  });

  it('runs the real customInit/customInstall hooks as a no-op when no old version is registered', () => {
    const result = spawnSync(hookExe, ['/S'], { env: envWith(longTemp, longTemp) });

    expect(result.status).toBe(0);
  });

  it('falls back to the system drive root when the old install drive root is unusable', () => {
    const [missingDrive] = missingDriveLetters(1);
    const windir = WINDIR;
    const outDir = makeOutDir();

    const result = runHarness(
      { MODE: 'prepare-only', OLD_DIR: `${missingDrive}:${path.sep}Titanhub`, FALLBACK: windir, OUT: outDir },
      envWith(longTemp, longTemp)
    );

    const harness = parseLog(path.join(outDir, 'harness.log'));
    trackShortTemp(harness.PREPARED);
    expect(result.status).toBe(0);
    expect(path.parse(harness.PREPARED).root.toLowerCase()).toBe(path.parse(windir).root.toLowerCase());
    expect(fs.statSync(harness.PREPARED).isDirectory()).toBe(true);
    expect(harness.TEMP_NOW).toBe(harness.PREPARED);
  });

  it('exits with a visible error and keeps TEMP when no short folder can be created', () => {
    const [oldDrive, fallbackDrive] = missingDriveLetters(2);
    const outDir = makeOutDir();

    const result = runHarness(
      { MODE: 'prepare-only', OLD_DIR: `${oldDrive}:${path.sep}Titanhub`, FALLBACK: `${fallbackDrive}:${path.sep}Windows`, OUT: outDir },
      envWith(longTemp, longTemp)
    );

    expect(result.status).toBe(BUSY_EXIT_CODE);
    expect(fs.existsSync(path.join(outDir, 'harness.log'))).toBe(false);
  });

  it('never reuses a short folder that already exists', () => {
    const outDir = makeOutDir();
    const existing = path.join(workRoot, 'th-exist');
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, MARKER_NAME), 'someone else');

    const result = runHarness({ MODE: 'try-create', DIR: existing, OUT: outDir }, envWith(longTemp, longTemp));

    expect(result.status).toBe(0);
    expect(parseLog(path.join(outDir, 'harness.log')).CREATE).toBe('exists');
    expect(fs.readFileSync(path.join(existing, MARKER_NAME), 'utf8')).toBe('someone else');
  });

  it('reports failure when the short folder parent does not exist', () => {
    const outDir = makeOutDir();
    const orphan = path.join(workRoot, 'missing-parent', 'th-orphan');

    runHarness({ MODE: 'try-create', DIR: orphan, OUT: outDir }, envWith(longTemp, longTemp));

    expect(parseLog(path.join(outDir, 'harness.log')).CREATE).toBe('failed');
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it('creates the short folder with a protected DACL limited to SYSTEM, Administrators and the owner', () => {
    const outDir = makeOutDir();
    const fresh = path.join(workRoot, 'th-fresh');

    runHarness({ MODE: 'try-create', DIR: fresh, OUT: outDir }, envWith(longTemp, longTemp));

    expect(parseLog(path.join(outDir, 'harness.log')).CREATE).toBe('created');
    const acl = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '$a = New-Object System.Security.AccessControl.DirectorySecurity($env:TH_ACL_DIR, [System.Security.AccessControl.AccessControlSections]::Access); $a.AreAccessRulesProtected; $a.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }',
    ], { env: { ...process.env, TH_ACL_DIR: fresh }, encoding: 'utf8' });
    const [isProtected, ...sids] = acl.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect(acl.status).toBe(0);
    expect(isProtected).toBe('True');
    expect(new Set(sids)).toEqual(new Set(['S-1-5-18', 'S-1-5-32-544', 'S-1-3-4']));
  });
});
