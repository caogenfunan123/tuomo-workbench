import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const args = new Set(process.argv.slice(2));
const writeIndex = process.argv.indexOf('--write-sbom');
const sbomPath = writeIndex >= 0 ? resolve(process.argv[writeIndex + 1] ?? 'release/sbom.json') : undefined;

function readVersion(text) {
  const match = /^version:\s*([^\s#]+)/m.exec(text);
  if (!match) throw new Error('pubspec.yaml does not declare version');
  const version = match[1];
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid pubspec version: ${version}`);
  return version;
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[\s"&^|<>]/.test(text)) return text;
  return `"${text.replace(/["^]/g, (character) => `^${character}`)}"`;
}

function run(command, commandArgs) {
  const windowsScript = process.platform === 'win32' && /\.(?:bat|cmd)$/.test(command);
  const executable = windowsScript ? (process.env.ComSpec ?? 'cmd.exe') : command;
  const executableArgs = windowsScript
    ? ['/d', '/s', '/c', [command, ...commandArgs].map(quoteCmdArg).join(' ')]
    : commandArgs;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      // The bundled Flutter SDK still initializes analytics for some Dart
      // subcommands even when --suppress-analytics is present. Keep the
      // release gate deterministic in locked-down build environments.
      FLUTTER_SUPPRESS_ANALYTICS: 'true',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} exited with ${result.status}`);
}

function flutterCommand(name) {
  const bundled = resolve(root, `.toolchain/flutter/bin/${name}${process.platform === 'win32' ? '.bat' : ''}`);
  return existsSync(bundled) ? bundled : name;
}

function sbomFrom(pubspecLock, applicationVersion) {
  const components = [];
  const lines = pubspecLock.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const name = /^  ([A-Za-z0-9_-]+):$/.exec(lines[index])?.[1];
    if (!name) continue;
    const version = /^    version:\s*"?([^"\s]+)"?/.exec(lines.slice(index, index + 8).join('\n'))?.[1];
    components.push({ type: 'library', name, version: version ?? 'unknown', ecosystem: 'Dart' });
  }
  return { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, components: [{ type: 'application', name: 'tuomo-workbench', version: applicationVersion }, ...components] };
}

const pubspec = await readFile(join(root, 'pubspec.yaml'), 'utf8');
const version = readVersion(pubspec);
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!packageJson.private) throw new Error('package.json must remain private for this workspace');
if (!args.has('--skip-tests')) run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check']);
run(process.execPath, ['scripts/platform-contract-check.mjs']);
if (!args.has('--skip-flutter')) {
  run(flutterCommand('dart'), ['format', '--suppress-analytics', '--output=none', '--set-exit-if-changed', '.']);
  run(flutterCommand('flutter'), ['analyze', '--suppress-analytics']);
  run(flutterCommand('flutter'), ['test', '--suppress-analytics']);
  run(flutterCommand('flutter'), ['build', 'web', '--suppress-analytics']);
  run(flutterCommand('dart'), ['--suppress-analytics', 'run', 'scripts/native-platform-smoke.dart']);
}
const temp = await mkdtemp(join(tmpdir(), 'tuomo-release-'));
try {
  if (!args.has('--skip-tests')) run(process.execPath, ['--experimental-strip-types', 'src/presentation/cli.ts', 'doctor', '--root', temp]);
} finally { await rm(temp, { recursive: true, force: true }); }
const sbom = sbomFrom(await readFile(join(root, 'pubspec.lock'), 'utf8'), version);
sbom.metadata = { timestamp: new Date().toISOString(), version };
if (sbomPath) { await writeFile(sbomPath, JSON.stringify(sbom, null, 2)); console.log(`SBOM: ${sbomPath}`); }
console.log(`Release preflight passed for ${version}`);
