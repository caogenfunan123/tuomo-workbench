import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JsonCacheStore } from '../src/infrastructure/cache-store.ts';
import { JsonSettingsStore } from '../src/infrastructure/settings-store.ts';

test('JSON cache supports expiry, pruning and full cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-cache-'));
  const cache = new JsonCacheStore(join(root, 'cache', 'entries.json'));
  await cache.put('remote/article', 'value', 1_000);
  assert.equal(await cache.get('remote/article', Date.now()), 'value');
  assert.equal(await cache.prune(Date.now() + 1_001), 1);
  assert.equal(await cache.get('remote/article'), undefined);
  await cache.put('one', '1');
  await cache.put('two', '2');
  assert.equal(await cache.clear(), 2);
  assert.deepEqual(await cache.list(), []);
  assert.match(await readFile(join(root, 'cache', 'entries.json'), 'utf8'), /^\[\s*\]/);
});

test('public settings validate language and proxy without allowing credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-settings-'));
  const store = new JsonSettingsStore(join(root, 'settings.json'));
  const value = { mode: 'standard' as const, pinned: [], hidden: [], theme: 'dark', editorTheme: 'default', nightMode: true, language: 'en-US' as const, proxyUrl: 'http://proxy.example:8080' };
  await store.write(value);
  assert.deepEqual(await store.read(), value);
  await assert.rejects(() => store.write({ ...value, proxyUrl: 'http://user:password@proxy.example' }), (error: any) => error.kind === 'security');
  await assert.rejects(() => store.write({ ...value, language: 'fr-FR' as any }), (error: any) => error.kind === 'validation');
});
