import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArticle, updateArticle } from '../src/domain/article.ts';
import { DomainError } from '../src/domain/errors.ts';
import { JsonArticleRepository } from '../src/infrastructure/json-article-repository.ts';
import { SaveDraftUseCase, SaveScheduler } from '../src/application/save-draft.ts';

test('JSON repository uses revision CAS, snapshots and readable Markdown export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-'));
  const repo = new JsonArticleRepository(root); await repo.init();
  const original = createArticle({ title: 'Draft', body: 'offline body' });
  await new SaveDraftUseCase(repo).execute(original);
  const changed = updateArticle(original, { title: 'Draft 2' });
  await new SaveDraftUseCase(repo).execute(changed);
  await assert.rejects(() => repo.put(changed, 0), (error: unknown) => error instanceof DomainError && error.kind === 'conflict');
  const exported = await readFile(join(root, 'exports', 'markdown', `${original.id}-Draft-2.md`), 'utf8');
  assert.match(exported, /title: Draft 2/);
  assert.match(exported, /offline body/);
  assert.match(await readFile(join(root, 'snapshots', original.id, '2.json'), 'utf8'), /Draft 2/);
});

test('JSON repository full-text search includes article body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-search-'));
  const repo = new JsonArticleRepository(root);
  const article = createArticle({ title: 'Short title', body: '正文里有一个独特的搜索词' });
  await repo.put(article, 0);
  assert.equal((await repo.list({ text: '独特的搜索词' })).length, 1);
  assert.equal((await repo.list({ text: '不存在的词' })).length, 0);
});

test('save scheduler keeps the confirmed CAS baseline across rapid edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-scheduler-'));
  const repo = new JsonArticleRepository(root);
  const original = createArticle({ title: 'one', body: 'first' });
  await repo.put(original, 0);
  const firstEdit = updateArticle(original, { title: 'two' });
  const secondEdit = updateArticle(firstEdit, { title: 'three', body: 'latest' });
  const scheduler = new SaveScheduler(new SaveDraftUseCase(repo), 1000);
  scheduler.schedule(firstEdit, original.localRevision);
  scheduler.schedule(secondEdit, original.localRevision);
  const results = await scheduler.flushAll();
  assert.equal(results.length, 1);
  assert.equal(results[0].state, 'saved');
  assert.equal((await repo.get(original.id))?.title, 'three');
  assert.equal((await repo.get(original.id))?.localRevision, 3);
});

test('snapshots can be listed, restored with CAS, deleted and pruned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-snapshots-'));
  const repo = new JsonArticleRepository(root);
  const article = createArticle({ title: 'Version one', body: 'first' });
  await repo.put(article, 0); await repo.snapshot(article);
  const changed = updateArticle(article, { title: 'Version two', body: 'second' });
  await repo.put(changed, 1); await repo.snapshot(changed);
  assert.deepEqual((await repo.listSnapshots(article.id)).map((item) => item.revision), [2, 1]);
  const restored = await repo.restoreSnapshot(article.id, 1, 2);
  assert.equal(restored.title, 'Version one');
  assert.equal(restored.localRevision, 3);
  await repo.deleteSnapshot(article.id, 1);
  assert.equal((await repo.listSnapshots(article.id)).some((item) => item.revision === 1), false);
  assert.equal(await repo.pruneSnapshots(article.id, 1), 1);
});

test('trash protects deletion and restores the original article', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-')); const repo = new JsonArticleRepository(root); const article = createArticle({ title: 'Keep me', body: 'body' });
  await repo.put(article, 0); await repo.moveToTrash(article.id); assert.equal(await repo.get(article.id), undefined); assert.equal((await repo.listTrash()).length, 1); await repo.restoreFromTrash(article.id); assert.equal((await repo.get(article.id))?.title, 'Keep me'); await repo.moveToTrash(article.id); await repo.deleteTrash(article.id); assert.equal((await repo.listTrash()).length, 0);
});

test('article ids reject path traversal before touching the filesystem', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-safe-id-')); const repository = new JsonArticleRepository(root);
  await assert.rejects(() => repository.get('../escape'), /Invalid article id/);
  await assert.rejects(() => repository.moveToTrash('../escape'), /Invalid article id/);
  await assert.rejects(() => repository.restoreFromTrash('../escape'), /Invalid article id/);
});
