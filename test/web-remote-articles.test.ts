import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RemoteArticleRollbackUseCase, HttpRemoteArticleQuery } from '../src/application/remote-articles.ts';
import type { StaticPublishGateway } from '../src/application/ports.ts';
import { createStaticSite } from '../src/domain/site.ts';
import { SafeRelativePath } from '../src/domain/values.ts';
import { JsonArticleRepository } from '../src/infrastructure/json-article-repository.ts';
import { InMemorySiteRegistry } from '../src/application/sites.ts';
import { SaveDraftUseCase } from '../src/application/save-draft.ts';
import { startWebServer } from '../src/presentation/web/server.ts';

test('web exposes remote article listing, content, history and CAS rollback', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-web-remote-'));
  const repository = new JsonArticleRepository(root);
  const site = createStaticSite({ id: 'remote', name: 'Remote', kind: 'static', isDefault: true, config: { provider: 'github', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const registry = new InMemorySiteRegistry([site]);
  const query = new HttpRemoteArticleQuery(async () => ({}), async (url) => {
    const value = String(url);
    if (value.includes('/commits?')) return new Response(JSON.stringify([{ sha: 'history-1', commit: { message: '历史版本' } }]), { status: 200 });
    if (value.includes('/contents/posts/a.md')) return new Response(JSON.stringify({ content: Buffer.from('# Historical').toString('base64'), encoding: 'base64', sha: 'remote-1' }), { status: 200 });
    return new Response(JSON.stringify([{ type: 'file', path: 'posts/a.md', sha: 'remote-1' }]), { status: 200 });
  });
  const rollback = new RemoteArticleRollbackUseCase(query, {
    async getFile(_site, path) { return { path, content: '# Current', revision: 'current' }; },
    async putFile(_site, file, expectedRevision) { assert.equal(expectedRevision, 'current'); assert.equal(file.content, '# Historical'); return { path: file.path.value, revision: 'rolled', committedAt: new Date().toISOString() }; },
    async deleteFile() {},
  } satisfies StaticPublishGateway);
  const server = startWebServer(repository, 0, new SaveDraftUseCase(repository), { siteRegistry: registry, remoteArticleQuery: query, remoteArticleRollback: rollback });
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const base = `http://127.0.0.1:${address!.port}`;
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

  const list = await fetch(`${base}/api/sites/remote/remote-articles`);
  assert.equal(list.status, 200);
  assert.equal((await list.json())[0].path, 'posts/a.md');
  const content = await fetch(`${base}/api/sites/remote/remote-articles/content?path=${encodeURIComponent('posts/a.md')}`);
  assert.equal((await content.json()).content, '# Historical');
  const history = await fetch(`${base}/api/sites/remote/remote-articles/history?path=${encodeURIComponent('posts/a.md')}`);
  assert.equal((await history.json())[0].id, 'history-1');
  const restored = await fetch(`${base}/api/sites/remote/remote-articles/rollback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'posts/a.md', targetRevision: 'history-1', expectedCurrentRevision: 'current' }) });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).revision, 'rolled');
});

test('remote article query supports Bitbucket source and commit envelopes', async () => {
  const site = createStaticSite({ id: 'bitbucket-remote', name: 'Bitbucket', kind: 'static', isDefault: true, config: { provider: 'bitbucket', repository: 'workspace/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const query = new HttpRemoteArticleQuery(undefined, async (url) => {
    const value = String(url);
    if (value.includes('/commits/')) return new Response(JSON.stringify({ values: [{ hash: 'bb-revision', message: 'Bitbucket history' }] }), { status: 200 });
    if (value.endsWith('/src/main/posts')) return new Response(JSON.stringify({ values: [{ type: 'commit_file', path: 'posts/a.md' }] }), { status: 200 });
    return new Response('# Bitbucket', { status: 200 });
  });
  assert.equal((await query.list(site))[0].path, 'posts/a.md');
  assert.equal((await query.get(site, 'posts/a.md')).content, '# Bitbucket');
  assert.equal((await query.history(site, 'posts/a.md'))[0].id, 'bb-revision');
});
