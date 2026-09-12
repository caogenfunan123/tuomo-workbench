import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticSite } from '../src/domain/site.ts';
import { SafeRelativePath } from '../src/domain/values.ts';
import { HttpRemoteArticleQuery, RemoteArticleCache, RemoteArticleRollbackUseCase } from '../src/application/remote-articles.ts';
import { InMemoryStaticPublishGateway } from '../src/infrastructure/memory-gateways.ts';

test('remote article query recursively lists Markdown and reads history', async () => {
  const site = createStaticSite({ id: 'remote', name: 'remote', kind: 'static', isDefault: true, config: { provider: 'github', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [], apiBaseUrl: 'https://git.test' } });
  const query = new HttpRemoteArticleQuery(undefined, async (url) => { if (url.includes('/commits')) return new Response(JSON.stringify([{ sha: 'c1', commit: { message: 'init', author: { name: 'a', date: '2026' } } }]), { status: 200 }); return new Response(JSON.stringify([{ type: 'file', path: 'posts/a.md', sha: 's1' }, { type: 'dir', path: 'posts/sub' }]), { status: 200 }); });
  const files = await query.list(site); assert.equal(files[0].path, 'posts/a.md'); assert.equal((await query.history(site, 'posts/a.md'))[0].id, 'c1');
  const cache = new RemoteArticleCache(); cache.put('k', 'f', files); assert.equal(cache.get('k', 'f')?.length, 1); assert.equal(cache.get('k', 'x'), undefined);
});

test('remote article rollback reads the selected history revision and preserves CAS', async () => {
  const site = createStaticSite({ id: 'rollback', name: 'rollback', kind: 'static', isDefault: true, config: { provider: 'generic', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const gateway = new InMemoryStaticPublishGateway();
  const current = await gateway.putFile(site, { path: SafeRelativePath.parse('posts/a.md'), content: 'new', warnings: [], framework: 'hexo' });
  const reader = { async get(_site: typeof site, path: string, revision: string) { assert.equal(revision, 'commit-old'); return { path, content: 'old', revision }; } };
  const result = await new RemoteArticleRollbackUseCase(reader, gateway).rollback(site, 'posts/a.md', 'commit-old', current.revision);
  assert.equal((await gateway.getFile(site, 'posts/a.md'))?.content, 'old');
  assert.equal(result.path, 'posts/a.md');
});
