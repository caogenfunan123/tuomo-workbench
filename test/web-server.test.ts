import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonArticleRepository } from '../src/infrastructure/json-article-repository.ts';
import { startWebServer } from '../src/presentation/web/server.ts';
import { JsonCacheStore } from '../src/infrastructure/cache-store.ts';
import { JsonSettingsStore } from '../src/infrastructure/settings-store.ts';
import { createCmsSite, createStaticSite } from '../src/domain/site.ts';
import { SafeRelativePath } from '../src/domain/values.ts';
import { InMemoryCmsPostGateway, InMemoryStaticPublishGateway } from '../src/infrastructure/memory-gateways.ts';
import { InMemorySiteRegistry, SiteHealthMonitor } from '../src/application/sites.ts';
import { CmsPublishUseCase, StaticPublishUseCase } from '../src/application/publish.ts';
import { SaveDraftUseCase } from '../src/application/save-draft.ts';
import { JsonWritingLibraryStore } from '../src/infrastructure/json-writing-library.ts';
import { BatchUploadUseCase, ImageHostUseCase, RssFeedService } from '../src/application/content-tools.ts';
import { SiteProvisioningUseCase } from '../src/application/provisioning.ts';
import { QuickWritingUseCase } from '../src/application/quick-actions.ts';

test('web workspace supports CRUD, search and optimistic revision protection', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-web-'));
  const repository = new JsonArticleRepository(root);
  const library = new JsonWritingLibraryStore(join(root, 'writing', 'library.json'));
  const quickWriting = new QuickWritingUseCase({ async *stream() { yield { type: 'token' as const, value: 'AI result' }; yield { type: 'done' as const }; } });
  const server = startWebServer(repository, 0, new SaveDraftUseCase(repository), { writingLibrary: library, quickWriting, aiModel: { id: 'test', group: 'default', priority: 0, healthy: true, failures: 0, contextLimit: 2048 } });
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const base = `http://127.0.0.1:${address!.port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  const createdResponse = await fetch(`${base}/api/articles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '初稿', body: '# 内容' }) });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: string; localRevision: number };
  assert.equal(created.localRevision, 1);

  const templateResponse = await fetch(`${base}/api/library/templates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '文章模板', framework: 'hexo', kind: 'post', frontMatter: 'title: {{title}}' }) });
  assert.equal(templateResponse.status, 201);
  const snippetResponse = await fetch(`${base}/api/library/snippets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '引用', body: '> 内容', tags: ['写作'] }) });
  assert.equal(snippetResponse.status, 201);
  const volumeResponse = await fetch(`${base}/api/library/volumes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '第一卷', articleIds: [created.id] }) });
  assert.equal(volumeResponse.status, 201);
  const volume = await volumeResponse.json() as { id: string };
  const volumeArticleResponse = await fetch(`${base}/api/library/volumes/${volume.id}/articles/${created.id}`, { method: 'POST' });
  assert.equal(volumeArticleResponse.status, 200);
  const statsResponse = await fetch(`${base}/api/library/stats/recompute`, { method: 'POST' });
  assert.equal((await statsResponse.json()).articles, 1);
  const libraryResponse = await fetch(`${base}/api/library`);
  assert.equal((await libraryResponse.json()).snippets.length, 1);

  const searchResponse = await fetch(`${base}/api/articles?text=${encodeURIComponent('初稿')}`);
  assert.equal(searchResponse.status, 200);
  assert.equal((await searchResponse.json()).length, 1);

  const previewResponse = await fetch(`${base}/api/markdown/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: '# 标题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```mermaid\ngraph TD\n```' }) });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as { html: string; toc: Array<{ anchor: string }> };
  assert.match(preview.html, /<table>/);
  assert.match(preview.html, /class="mermaid"/);
  assert.equal(preview.toc[0]?.anchor, '标题');
  const formatResponse = await fetch(`${base}/api/markdown/format`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: '标题  \n\n\n正文' }) });
  assert.equal((await formatResponse.json()).markdown, '标题\n\n正文\n');
  const replaceResponse = await fetch(`${base}/api/markdown/replace`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: 'Hello hello', search: 'hello', replacement: 'Hi' }) });
  assert.equal((await replaceResponse.json()).markdown, 'Hi Hi');

  const updateResponse = await fetch(`${base}/api/articles/${created.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '已编辑', body: '正文', expectedRevision: 1 }) });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json() as { localRevision: number };
  assert.equal(updated.localRevision, 2);

  const snapshotsResponse = await fetch(`${base}/api/articles/${created.id}/snapshots`);
  assert.equal(snapshotsResponse.status, 200);
  const snapshots = await snapshotsResponse.json() as Array<{ revision: number }>;
  assert.ok(snapshots.some((snapshot) => snapshot.revision === 2));
  const restoreSnapshotResponse = await fetch(`${base}/api/articles/${created.id}/snapshots/1/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2 }) });
  assert.equal(restoreSnapshotResponse.status, 200);
  assert.equal((await restoreSnapshotResponse.json()).localRevision, 3);
  const deleteSnapshotResponse = await fetch(`${base}/api/articles/${created.id}/snapshots/1`, { method: 'DELETE' });
  assert.equal(deleteSnapshotResponse.status, 204);
  const exportResponse = await fetch(`${base}/api/articles/${created.id}?format=html`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await exportResponse.text(), /初稿/);
  const importResponse = await fetch(`${base}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: 'markdown', filename: 'imported.md', bytesBase64: Buffer.from('---\ntitle: 导入\n---\n\n内容').toString('base64') }) });
  assert.equal(importResponse.status, 201);

  const conflictResponse = await fetch(`${base}/api/articles/${created.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '过期写入', expectedRevision: 1 }) });
  assert.equal(conflictResponse.status, 409);

  const pageResponse = await fetch(`${base}/`);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /实时预览/);
  assert.match(page, /导入文件/);
  assert.match(page, /snapshots-button/);
  assert.match(page, /\/api\/import/);
  assert.match(page, /name="tags"/);
  assert.match(page, /name="scheduleAt"/);
  assert.match(page, /id="sites-button"/);
  assert.match(page, /id="add-cms"/);
  assert.match(page, /id="provision-site"/);
  assert.match(page, /id="trigger-build"/);
  assert.match(page, /id="batch-upload"/);
  assert.match(page, /id="ai-button"/);
  assert.match(page, /\/api\/ai\/quick/);
  assert.match(page, /id="tools-button"/);
  assert.match(page, /\/api\/tools\/rss/);
  assert.match(page, /\/api\/tools\/links/);
  assert.match(page, /\/api\/tools\/image/);
  assert.match(page, /id="site-health"/);
  assert.match(page, /id="remote-articles"/);
  assert.match(page, /remote-articles\/content/);
  assert.match(page, /\/api\/sites\/health/);
  assert.match(page, /内容资产/);
  assert.match(page, /\/api\/library/);
  assert.match(page, /publish\/preview/);
  assert.match(page, /id="format-markdown"/);
  assert.match(page, /id="find-replace"/);
  assert.match(page, /\/api\/markdown\/preview/);
  const scriptStart = page.indexOf('<script>') + '<script>'.length;
  const scriptEnd = page.lastIndexOf('</script>');
  assert.doesNotThrow(() => new Function(page.slice(scriptStart, scriptEnd)));

  const aiResponse = await fetch(`${base}/api/ai/quick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'summary', text: '需要总结的内容' }) });
  assert.equal(aiResponse.status, 200);
  assert.equal((await aiResponse.json()).text, 'AI result');

  const deleteResponse = await fetch(`${base}/api/articles/${created.id}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 204);
  assert.equal((await fetch(`${base}/api/articles/${created.id}`)).status, 404);
  const trashResponse = await fetch(`${base}/api/trash`);
  assert.equal(trashResponse.status, 200);
  assert.equal((await trashResponse.json()).length, 1);
  const restoreResponse = await fetch(`${base}/api/trash/${created.id}/restore`, { method: 'POST' });
  assert.equal(restoreResponse.status, 200);
  assert.equal((await fetch(`${base}/api/articles/${created.id}`)).status, 200);
  await fetch(`${base}/api/articles/${created.id}`, { method: 'DELETE' });
  const deleteTrashResponse = await fetch(`${base}/api/trash/${created.id}/delete`, { method: 'DELETE' });
  assert.equal(deleteTrashResponse.status, 204);
  assert.equal((await (await fetch(`${base}/api/trash`)).json()).length, 0);
  const missingRestoreResponse = await fetch(`${base}/api/trash/${created.id}/restore`, { method: 'POST' });
  assert.equal(missingRestoreResponse.status, 404);
});

test('web workspace exposes site lifecycle and injected publish use cases', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-web-sites-'));
  const repository = new JsonArticleRepository(root);
  const staticSite = createStaticSite({ id: 'static', name: 'Static', kind: 'static', isDefault: true, config: { provider: 'generic', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const cmsSite = createCmsSite({ id: 'cms', name: 'CMS', kind: 'cms', isDefault: false, config: { cmsKind: 'wordpress', baseUrl: 'https://cms.example.test', ignoreSsl: false, adapterOptions: {} } });
  const registry = new InMemorySiteRegistry([staticSite, cmsSite]);
  let builds = 0;
  const staticPublisher = new StaticPublishUseCase(repository, new InMemoryStaticPublishGateway());
  const cmsPublisher = new CmsPublishUseCase(repository, new InMemoryCmsPostGateway());
  const healthMonitor = new SiteHealthMonitor(registry, async () => ({ reachable: true, pageNonEmpty: true }));
  const server = startWebServer(repository, 0, new SaveDraftUseCase(repository), { siteRegistry: registry, healthMonitor, staticPublisher, cmsPublisher, buildTrigger: async () => ({ triggered: ++builds }) });
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const base = `http://127.0.0.1:${address!.port}`;
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

  const createdResponse = await fetch(`${base}/api/articles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '可发布文章', body: '这是足够长的文章正文，用于验证发布中心。' }) });
  const created = await createdResponse.json() as { id: string };
  const secretSiteResponse = await fetch(`${base}/api/sites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'unsafe', name: 'Unsafe', kind: 'cms', config: { cmsKind: 'wordpress', baseUrl: 'https://cms.example.test', password: 'must-not-persist' } }) });
  assert.equal(secretSiteResponse.status, 403);
  const malformedRefResponse = await fetch(`${base}/api/sites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'malformed-ref', name: 'Malformed ref', kind: 'static', config: { provider: 'github', repository: 'owner/repo', branch: 'main', postPath: 'posts', pagePath: 'pages', framework: 'hexo', credentialRef: 'token-ref' } }) });
  assert.equal(malformedRefResponse.status, 403);
  const sitesResponse = await fetch(`${base}/api/sites`);
  assert.equal((await sitesResponse.json()).activeSiteId, 'static');
  const healthResponse = await fetch(`${base}/api/sites/health`);
  assert.equal((await healthResponse.json())[0].status, 'healthy');
  const buildResponse = await fetch(`${base}/api/sites/static/build`, { method: 'POST' });
  assert.deepEqual(await buildResponse.json(), { triggered: 1 });
  const previewResponse = await fetch(`${base}/api/articles/${created.id}/publish/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteIds: ['static'] }) });
  assert.equal(previewResponse.status, 200);
  assert.equal((await previewResponse.json())[0].siteId, 'static');
  const publishResponse = await fetch(`${base}/api/articles/${created.id}/publish/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteIds: ['static'], confirmed: true }) });
  assert.equal(publishResponse.status, 200);
  assert.equal((await publishResponse.json()).results[0].ok, true);
  const cmsResponse = await fetch(`${base}/api/articles/${created.id}/publish/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteIds: ['cms'], kind: 'cms' }) });
  assert.equal(cmsResponse.status, 200);
  assert.equal((await cmsResponse.json()).results[0].ok, true);
  await fetch(`${base}/api/sites/static/active`, { method: 'POST' });
  const deleteResponse = await fetch(`${base}/api/sites/cms`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 204);
});

test('web exposes RSS, link checking and image upload tools with URL safety', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-web-tools-'));
  const repository = new JsonArticleRepository(root);
  const site = createStaticSite({ id: 'github-images', name: 'GitHub images', kind: 'static', isDefault: true, config: { provider: 'github', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const registry = new InMemorySiteRegistry([site]);
  const cacheStore = new JsonCacheStore(join(root, 'cache', 'entries.json'));
  const settingsStore = new JsonSettingsStore(join(root, 'settings', 'public.json'));
  await cacheStore.put('tools/demo', 'cached');
  const rssFeed = new RssFeedService(async () => '<rss><channel><item><title>测试条目</title><link>https://example.com/article</link></item></channel></rss>');
  const imageHostFactory = () => new ImageHostUseCase({ upload: async () => ({ markdownUrl: 'https://cdn.example.com/image.png', remoteId: 'sha' }) });
  const server = startWebServer(repository, 0, new SaveDraftUseCase(repository), { siteRegistry: registry, rssFeed, linkProbe: async (url) => ({ ok: url.includes('good'), status: url.includes('good') ? 200 : 404 }), imageHostFactory, batchUploadFactory: () => new BatchUploadUseCase(async () => undefined, async () => undefined, async () => undefined), cacheStore, settingsStore });
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const base = `http://127.0.0.1:${address!.port}`;
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

  const rss = await fetch(`${base}/api/tools/rss?url=${encodeURIComponent('https://example.com/feed.xml')}`);
  assert.equal(rss.status, 200);
  assert.equal((await rss.json())[0].title, '测试条目');
  const blocked = await fetch(`${base}/api/tools/rss?url=${encodeURIComponent('http://127.0.0.1/feed.xml')}`);
  assert.equal(blocked.status, 403);
  const links = await fetch(`${base}/api/tools/links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: '[good](https://good.example) [bad](https://bad.example)' }) });
  assert.equal(links.status, 200);
  assert.equal((await links.json()).results.filter((item: { ok: boolean }) => item.ok).length, 1);
  const privateLink = await fetch(`${base}/api/tools/links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: '[private](http://127.0.0.1/admin)' }) });
  assert.equal(privateLink.status, 200);
  assert.match((await privateLink.json()).results[0].error, /Private/);
  const image = await fetch(`${base}/api/tools/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: 'image.png', mimeType: 'image/png', bytesBase64: Buffer.from('png').toString('base64') }) });
  assert.equal(image.status, 200);
  assert.equal((await image.json()).result.markdownUrl, 'https://cdn.example.com/image.png');
  const batch = await fetch(`${base}/api/tools/batch-upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteId: 'github-images', files: [{ path: 'posts/a.md', bytesBase64: Buffer.from('# A').toString('base64') }] }) });
  assert.equal(batch.status, 200);
  assert.equal((await batch.json()).results[0].method, 'git-data');
  const cache = await fetch(`${base}/api/tools/cache/clear`, { method: 'POST' });
  assert.equal(cache.status, 200);
  assert.equal((await cache.json()).cleared, 1);
  const settings = await fetch(`${base}/api/settings`);
  assert.equal(settings.status, 200);
  const savedSettings = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'standard', pinned: [], hidden: [], theme: 'system', editorTheme: 'default', nightMode: false, language: 'en-US', proxyUrl: 'http://proxy.example:8080' }) });
  assert.equal(savedSettings.status, 200);
  assert.equal((await savedSettings.json()).language, 'en-US');
});

test('web exposes one-click provisioning with injected rollback workflow', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-web-provision-'));
  const repository = new JsonArticleRepository(root);
  const calls: string[] = [];
  const registry = new InMemorySiteRegistry();
  const provisioning = new SiteProvisioningUseCase({
    async createRepository() { calls.push('create'); return { id: 'repo-1', url: 'https://pages.example.com' }; },
    async writeFile(_repositoryId, path) { calls.push(`write:${path}`); },
    async enablePages() { calls.push('pages'); },
    async attachCloudflare() { calls.push('cloudflare'); return { projectId: 'project-1' }; },
    async triggerBuild() { calls.push('build'); },
    async waitForBuild() { calls.push('wait'); return { ok: true, url: 'https://pages.example.com' }; },
    async deleteRepository() { calls.push('rollback'); },
  }, undefined, registry);
  const server = startWebServer(repository, 0, new SaveDraftUseCase(repository), { provisioning, siteRegistry: registry });
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const base = `http://127.0.0.1:${address!.port}`;
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

  const invalid = await fetch(`${base}/api/sites/provision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'github' }) });
  assert.equal(invalid.status, 400);
  const response = await fetch(`${base}/api/sites/provision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'github', owner: 'owner', repository: 'repo', framework: 'hexo', mode: 'pages', welcomePost: '# Welcome' }) });
  assert.equal(response.status, 200);
  const result = await response.json() as { ok: boolean; siteId?: string };
  assert.equal(result.ok, true);
  assert.equal(result.siteId, 'provision-github-owner-repo');
  assert.equal(registry.get(result.siteId)?.config.repository, 'owner/repo');
  assert.deepEqual(calls, ['create', 'write:README.md', 'write:.tuomo/framework.json', 'write:.github/workflows/tuomo-pages.yml', 'pages', 'write:posts/welcome.md', 'build', 'wait']);
});
