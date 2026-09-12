import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonSettingsStore, ReleaseManifestStore, UpdateChecker } from '../src/infrastructure/settings-store.ts';

test('settings store atomically persists public preferences and update check compares versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-settings-')); const store = new JsonSettingsStore(join(root, 'settings', 'public.json')); const preferences = { mode: 'standard' as const, pinned: ['editor'], hidden: [], theme: 'dark', editorTheme: 'default', nightMode: true }; await store.write(preferences); assert.deepEqual(await store.read(), preferences); assert.doesNotMatch(await readFile(join(root, 'settings', 'public.json'), 'utf8'), /token|password/i); const result = await new UpdateChecker(async () => ({ version: '1.2.0' })).check('https://release.test/release.json', '1.1.0'); assert.equal(result.available, true);
});

test('release manifest is read from the project root and validates build versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-release-manifest-'));
  await writeFile(join(root, 'release.json'), JSON.stringify({ version: '1.2.3+4', notes: 'Current' }));
  assert.deepEqual(await new ReleaseManifestStore(root).read(), { version: '1.2.3+4', notes: 'Current' });
  const result = await new UpdateChecker(async () => ({ version: '1.2.4' })).check('https://release.test/release.json', '1.2.3+4');
  assert.equal(result.available, true);
  await rm(root, { recursive: true, force: true });
});

test('public settings reject sensitive credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-settings-secret-'));
  const store = new JsonSettingsStore(join(root, 'settings.json'));
  await assert.rejects(() => store.write({ mode: 'standard', pinned: [], hidden: [], theme: 'system', editorTheme: 'default', nightMode: false, token: 'secret' } as any), /SecretStore/);
});
