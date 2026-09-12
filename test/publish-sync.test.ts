import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArticle } from '../src/domain/article.ts';
import { SafeRelativePath } from '../src/domain/values.ts';
import { createCmsSite, createStaticSite } from '../src/domain/site.ts';
import { JsonArticleRepository } from '../src/infrastructure/json-article-repository.ts';
import { InMemoryCmsPostGateway, InMemoryStaticPublishGateway } from '../src/infrastructure/memory-gateways.ts';
import { InMemoryBindingStore } from '../src/infrastructure/memory-stores.ts';
import { CmsArticleLifecycleUseCase, CmsPublishUseCase, StaticPublishUseCase } from '../src/application/publish.ts';
import { compareSync } from '../src/domain/sync.ts';
import type { Manifest } from '../src/domain/sync.ts';
import { SyncUseCase } from '../src/application/sync.ts';
import { StaticFileLifecycleUseCase } from '../src/application/static-lifecycle.ts';

function site() { return createStaticSite({ name: 'blog', kind: 'static', isDefault: true, config: { provider: 'generic', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } }); }

test('static publishing re-reads SHA and never silently overwrites a remote change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-')); const articles = new JsonArticleRepository(root); const article = createArticle({ title: 'Publish', body: 'This body is long enough for publishing.' }); await articles.put(article, 0);
  const blogSite = site(); const gateway = new InMemoryStaticPublishGateway(); const useCase = new StaticPublishUseCase(articles, gateway, undefined, new InMemoryBindingStore());
  const preview = await useCase.preview(article.id, [blogSite]);
  const remote = await gateway.putFile(blogSite, { ...preview[0].file, content: 'remote change' });
  const result = await useCase.publish(article.id, [blogSite], async () => { gateway.files.set(`${blogSite.id}:${preview[0].file.path.value}`, { path: preview[0].file.path.value, content: 'remote change', revision: 'external' }); return true; });
  assert.equal(result[0].ok, false); assert.equal((result[0].error as any).kind, 'conflict'); assert.equal((await gateway.getFile(blogSite, preview[0].file.path.value))?.revision, 'external');
});

test('sync compare distinguishes same object, one-sided change and conflict', () => {
  const base = { objectType: 'article' as const, objectId: 'a', revision: 1, hash: 'base', modifiedAt: '', originDeviceId: 'x' };
  assert.equal(compareSync(base, { ...base }), 'inSync');
  assert.equal(compareSync({ ...base, revision: 2, hash: 'local' }, base, base), 'pushRequired');
  assert.equal(compareSync({ ...base, revision: 2, hash: 'local' }, { ...base, revision: 2, hash: 'remote' }, base), 'conflict');
  const manifest: Manifest = { deviceId: 'x', objects: [base], updatedAt: '' }; assert.equal(manifest.objects.length, 1);
});

test('batch static publishing confirms once, caps concurrency and keeps per-site results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-batch-'));
  const articles = new JsonArticleRepository(root);
  const article = createArticle({ title: 'Batch', body: 'This body is long enough for batch publishing.' });
  await articles.put(article, 0);
  const sites = Array.from({ length: 7 }, (_, index) => createStaticSite({ ...site(), id: `site-${index}` }));
  const gateway = new InMemoryStaticPublishGateway();
  const originalGet = gateway.getFile.bind(gateway);
  let running = 0;
  let maximum = 0;
  gateway.getFile = async (...args) => {
    running++;
    maximum = Math.max(maximum, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try { return await originalGet(...args); } finally { running--; }
  };
  const useCase = new StaticPublishUseCase(articles, gateway);
  let confirmations = 0;
  const result = await useCase.publishBatch(article.id, sites, () => { confirmations++; return true; });
  assert.equal(confirmations, 1);
  assert.equal(result.cancelled, false);
  assert.equal(result.results.length, sites.length);
  assert.ok(result.results.every((item) => item.ok));
  assert.ok(maximum <= 4);
});

test('sync conflicts resolve to local, remote or a new merged object', async () => {
  const useCase = new SyncUseCase({ async push() {}, async pull() { return { objects: {} }; } });
  const local = { objectType: 'article' as const, objectId: 'a', revision: 2, hash: 'local-hash', modifiedAt: '', originDeviceId: 'local' };
  const remote = { objectType: 'article' as const, objectId: 'a', revision: 2, hash: 'remote-hash', modifiedAt: '', originDeviceId: 'remote' };
  const pulled = { report: { pushed: [], pulled: [], missing: [], conflicts: [{ object: remote, local, remote }] }, payloads: { 'article:a': 'local' } };
  const resolved = await useCase.resolveConflicts({ deviceId: 'local', objects: [local], updatedAt: '' }, pulled, [{ key: 'article:a', choice: 'merged', payload: 'merged' }], { 'article:a': 'remote' });
  assert.deepEqual(resolved.payloads['article:a'], 'merged');
  assert.equal(resolved.manifest.objects[0].revision, 3);
  assert.equal(resolved.manifest.objects[0].hash.length, 64);
  assert.deepEqual(resolved.resolved, ['article:a']);
});

test('sync use case reports pull/missing states and validates conflict choices', async () => {
  const audits: string[] = [];
  const transport = {
    async push(objects: Record<string, unknown>) {
      assert.ok(objects['article:a']);
    },
    async pull() {
      return {
        objects: {
          'article:a': { payload: 'remote', revision: 2, hash: 'remote-hash', modifiedAt: '' },
          'article:remote-only': { payload: 'new', revision: 1, hash: 'new-hash', modifiedAt: '' },
        },
      };
    },
  };
  const useCase = new SyncUseCase(transport, { async append(event) { audits.push(event.action); } });
  const local = {
    deviceId: 'local',
    updatedAt: '',
    objects: [
      { objectType: 'article' as const, objectId: 'a', revision: 2, hash: 'local-hash', modifiedAt: '', originDeviceId: 'local' },
      { objectType: 'article' as const, objectId: 'local-only', revision: 1, hash: 'old-hash', modifiedAt: '', originDeviceId: 'local' },
    ],
  };
  assert.equal(useCase.compare(local, { deviceId: 'remote', updatedAt: '', objects: [] })
      .find((item) => item.key === 'article:local-only')?.status, 'missing');
  await useCase.push(local, { 'article:a': 'local', 'article:local-only': 'old' });
  const pulled = await useCase.pull(local, {});
  assert.deepEqual(pulled.report.pulled, ['article:remote-only']);
  assert.deepEqual(pulled.report.missing, ['article:local-only']);
  assert.equal(pulled.report.conflicts.length, 1);
  assert.equal(pulled.payloads['article:remote-only'], 'new');
  assert.deepEqual(audits, ['sync.push', 'sync.pull']);

  const conflict = pulled.report.conflicts[0];
  assert.equal(useCase.resolveConflict(conflict, { 'article:a': 'local', 'article:a@remote': 'remote' }, { key: 'article:a', choice: 'local' }).payload, 'local');
  assert.equal(useCase.resolveConflict(conflict, { 'article:a': 'local', 'article:a@remote': 'remote' }, { key: 'article:a', choice: 'remote' }).payload, 'remote');
  assert.throws(() => useCase.resolveConflict(conflict, {}, { key: 'wrong', choice: 'local' }), /does not match/);
  assert.throws(() => useCase.resolveConflict(conflict, {}, { key: 'article:a', choice: 'local' }), /Missing payload/);
  assert.throws(() => SyncUseCase.object('article', 'empty', '', 1, 'local'), /cannot be empty/);
});

test('CMS batch publishing caps concurrency and preserves per-site failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-cms-batch-'));
  const articles = new JsonArticleRepository(root);
  const article = createArticle({ title: 'CMS batch', body: 'This body is long enough for CMS batch publishing.' });
  await articles.put(article, 0);
  const sites = Array.from({ length: 7 }, (_, index) => createCmsSite({
    id: `cms-${index}`,
    name: `CMS ${index}`,
    kind: 'cms',
    isDefault: index === 0,
    config: { cmsKind: 'ghost', baseUrl: 'https://cms.example.test', ignoreSsl: false, adapterOptions: {} },
  }));
  let running = 0;
  let maximum = 0;
  const gateway = {
    async list() { return []; },
    async create(site: typeof sites[number], post: any) {
      running++;
      maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      if (site.id === 'cms-3') throw new Error('one CMS failed');
      return { id: site.id, ...post, revision: 'r1', updatedAt: new Date().toISOString() };
    },
    async update() { throw new Error('not used'); },
    async delete() { throw new Error('not used'); },
  };
  const results = await new CmsPublishUseCase(articles, gateway).publishMany(article.id, sites);
  assert.equal(results.length, sites.length);
  assert.equal(results.find((item) => item.siteId === 'cms-3')?.ok, false);
  assert.ok(results.filter((item) => item.ok).length === sites.length - 1);
  assert.ok(maximum <= 4);
});

test('static remote file batch deletion keeps partial results and CAS protection', async () => {
  const blogSite = site();
  const gateway = new InMemoryStaticPublishGateway();
  const file = { path: SafeRelativePath.parse('posts/remove.md'), content: 'content', warnings: [], framework: 'hexo' };
  const stored = await gateway.putFile(blogSite, file);
  const results = await new StaticFileLifecycleUseCase(gateway).deleteMany([
    { site: blogSite, path: file.path.value, expectedRevision: stored.revision },
    { site: blogSite, path: file.path.value, expectedRevision: 'stale' },
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
});

test('remote delete batches report partial results when cancelled', async () => {
  const blogSite = site(); const gateway = new InMemoryStaticPublishGateway();
  const files = await Promise.all(['a', 'b', 'c'].map((name) => gateway.putFile(blogSite, { path: SafeRelativePath.parse(`posts/${name}.md`), content: name, warnings: [], framework: 'hexo' })));
  const controller = new AbortController(); let calls = 0;
  const original = gateway.deleteFile.bind(gateway);
  gateway.deleteFile = async (...args) => { calls++; if (calls === 1) controller.abort(); await new Promise((resolve) => setTimeout(resolve, 5)); return original(...args); };
  const result = await new StaticFileLifecycleUseCase(gateway).deleteManyDetailed(files.map((file) => ({ site: blogSite, path: file.path, expectedRevision: file.revision })), 2, controller.signal);
  assert.equal(result.cancelled, true); assert.ok(result.results.length >= 1); assert.ok(result.results.length < files.length);
});

test('remote file deletion keeps a recoverable backup and refuses overwrite on restore', async () => {
  const blogSite = site();
  const gateway = new InMemoryStaticPublishGateway();
  const file = { path: SafeRelativePath.parse('posts/recover.md'), content: 'recover me', warnings: [], framework: 'hexo' as const };
  const stored = await gateway.putFile(blogSite, file);
  const lifecycle = new StaticFileLifecycleUseCase(gateway);
  const deleted = await lifecycle.deleteRecoverable(blogSite, file.path.value, stored.revision);
  assert.equal(await gateway.getFile(blogSite, file.path.value), undefined);
  await lifecycle.restoreDeleted(deleted);
  assert.equal((await gateway.getFile(blogSite, file.path.value))?.content, 'recover me');
  await assert.rejects(() => lifecycle.restoreDeleted(deleted), /revision|conflict/i);
});

test('batch publishing honors cancellation before remote writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-cancel-'));
  const articles = new JsonArticleRepository(root);
  const article = createArticle({ title: 'Cancel', body: 'This body is long enough for cancellation.' });
  await articles.put(article, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
      () => new StaticPublishUseCase(articles, new InMemoryStaticPublishGateway())
          .publishBatch(article.id, [site()], () => true, new Date(), controller.signal),
      /cancelled/i);
});

test('batch publishing returns completed sites when cancelled during remote writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-cancel-mid-'));
  const articles = new JsonArticleRepository(root);
  const article = createArticle({ title: 'Cancel during batch', body: 'This body is long enough for mid batch cancellation.' });
  await articles.put(article, 0);
  const controller = new AbortController();
  const gateway = new InMemoryStaticPublishGateway();
  const originalPut = gateway.putFile.bind(gateway);
  let writes = 0;
  gateway.putFile = async (...args) => {
    writes++;
    if (writes === 1) controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return originalPut(...args);
  };
  const sites = Array.from({ length: 6 }, (_, index) => createStaticSite({ ...site(), id: `cancel-site-${index}` }));
  const result = await new StaticPublishUseCase(articles, gateway)
      .publishBatch(article.id, sites, () => true, new Date(), controller.signal);
  assert.equal(result.cancelled, true);
  assert.ok(result.results.length >= 1);
  assert.ok(result.results.length < sites.length);
});

test('CMS article lifecycle deletes with CAS-independent per-site results', async () => {
  const gateway = new InMemoryCmsPostGateway();
  const cms = createCmsSite({ id: 'cms-delete', name: 'CMS delete', kind: 'cms', isDefault: true, config: { cmsKind: 'wordpress', baseUrl: 'https://cms.example.test', ignoreSsl: false, adapterOptions: {} } });
  const remote = await gateway.create(cms, { title: 'Delete', markdown: 'body', tags: [], categories: [], status: 'draft', date: '' });
  const results = await new CmsArticleLifecycleUseCase(gateway).deleteMany([{ site: cms, remoteId: remote.id }, { site: cms, remoteId: 'missing' }]);
  assert.deepEqual(results.map((item) => item.ok), [true, false]);
  assert.equal((await gateway.list(cms, {})).length, 0);
});

test('CMS delete batches report completed sites when cancelled', async () => {
  const cms = createCmsSite({ id: 'cms-delete-cancel', name: 'CMS delete cancel', kind: 'cms', isDefault: true, config: { cmsKind: 'wordpress', baseUrl: 'https://cms.example.test', ignoreSsl: false, adapterOptions: {} } });
  const gateway = new InMemoryCmsPostGateway(); const remote = await gateway.create(cms, { title: 'Delete', markdown: 'body', tags: [], categories: [], status: 'draft', date: '' });
  const controller = new AbortController(); let calls = 0;
  const original = gateway.delete.bind(gateway); gateway.delete = async (...args) => { calls++; if (calls === 1) controller.abort(); await new Promise((resolve) => setTimeout(resolve, 5)); return original(...args); };
  const result = await new CmsArticleLifecycleUseCase(gateway).deleteManyDetailed([{ site: cms, remoteId: remote.id }, { site: cms, remoteId: 'missing-a' }, { site: cms, remoteId: 'missing-b' }], 2, controller.signal);
  assert.equal(result.cancelled, true); assert.ok(result.results.length >= 1); assert.ok(result.results.length < 3);
});

test('static publish records mirror and hook outcomes and respects confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-effects-'));
  const articles = new JsonArticleRepository(root);
  const article = createArticle({ title: 'Effects', body: 'This body is long enough for side effects.' });
  await articles.put(article, 0);
  const base = site();
  const configured = createStaticSite({
    ...base,
    config: { ...base.config, mirrors: ['https://mirror.example.test/push'], hooks: ['https://hooks.example.test/deploy'] },
  });
  const sideEffects = {
    async pushMirror() {},
    async triggerHook() { throw new Error('hook unavailable'); },
  };
  const published = await new StaticPublishUseCase(articles, new InMemoryStaticPublishGateway(), undefined, undefined, undefined, sideEffects)
      .publish(article.id, [configured], () => true);
  assert.equal(published[0].ok, true);
  assert.deepEqual(published[0].sideEffects?.map((item) => [item.kind, item.ok]), [['mirror', true], ['hook', false]]);
  await assert.rejects(
      () => new StaticPublishUseCase(articles, new InMemoryStaticPublishGateway()).publish(article.id, [configured], () => false),
      /cancelled/);
  await assert.rejects(
      () => new StaticPublishUseCase(articles, new InMemoryStaticPublishGateway()).preview('missing', [configured]),
      /not found/);
});
