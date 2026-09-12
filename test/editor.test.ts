import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticle } from '../src/domain/article.ts';
import { DocumentSession, InMemorySessionRecoveryStore } from '../src/application/editor.ts';
import { JsonSessionRecoveryStore } from '../src/infrastructure/session-recovery.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('document sessions keep independent content and reject stale save acknowledgement', async () => {
  const first = new DocumentSession(createArticle({ id: 'a', title: 'A', body: 'one' }));
  const second = new DocumentSession(createArticle({ id: 'b', title: 'B', body: 'two' }));
  first.edit({ body: 'first changed' }); second.edit({ body: 'second changed' });
  assert.equal(first.snapshot.article.body, 'first changed'); assert.equal(second.snapshot.article.body, 'second changed');
  first.markSaving(); first.markSaved(999); assert.equal(first.snapshot.status, 'saving'); first.markSaved(first.snapshot.article.localRevision); assert.equal(first.snapshot.status, 'saved');
  const recovery = new InMemorySessionRecoveryStore(); await recovery.save(second.snapshot); assert.equal((await recovery.load(second.id))?.article.body, 'second changed');
});

test('file session recovery rejects unsafe ids before constructing a path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-recovery-'));
  const recovery = new JsonSessionRecoveryStore(root);
  await assert.rejects(() => recovery.load('../escape' as never), /Invalid article id/);
  await assert.rejects(() => recovery.remove('../escape' as never), /Invalid article id/);
});
