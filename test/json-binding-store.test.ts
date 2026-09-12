import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonBindingStore } from '../src/infrastructure/json-binding-store.ts';

test('JSON binding store survives restart and replaces one site/article binding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-bindings-'));
  const path = join(root, 'sites', 'bindings.json');
  try {
    const store = new JsonBindingStore(path);
    await store.put({ siteId: 'site-a' as never, articleId: 'article-a', remoteId: 'remote-1', remoteRevision: 'r1', baseContentHash: 'h1', syncedAt: '2026-01-01T00:00:00Z' });
    await store.put({ siteId: 'site-b' as never, articleId: 'article-a', remotePath: 'posts/a.md', remoteRevision: 'r2', baseContentHash: 'h2', syncedAt: '2026-01-02T00:00:00Z' });
    await store.put({ siteId: 'site-a' as never, articleId: 'article-a', remoteId: 'remote-2', remoteRevision: 'r3', baseContentHash: 'h3', syncedAt: '2026-01-03T00:00:00Z' });
    assert.equal((await store.get('site-a', 'article-a'))?.remoteId, 'remote-2');
    assert.equal((await store.list('site-a')).length, 1);
    const restored = new JsonBindingStore(path);
    assert.equal((await restored.get('site-b', 'article-a'))?.remotePath, 'posts/a.md');
    await restored.remove('site-a', 'article-a');
    assert.equal((await restored.get('site-a', 'article-a')), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
