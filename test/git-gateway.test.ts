import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticSite } from '../src/domain/site.ts';
import { SafeRelativePath } from '../src/domain/values.ts';
import { HttpGitGateway } from '../src/infrastructure/git-gateway.ts';

test('Git HTTP gateway reads base64 content and uses optimistic SHA on writes', async () => {
  let method = ''; let body = ''; const gateway = new HttpGitGateway(async () => 'token', async (_url, init) => { method = init?.method ?? ''; body = String(init?.body ?? ''); if (method === 'GET') return new Response(JSON.stringify({ content: Buffer.from('old').toString('base64'), encoding: 'base64', sha: 'old-sha' }), { status: 200 }); return new Response(JSON.stringify({ content: { sha: 'new-sha' } }), { status: 200 }); });
  const site = createStaticSite({ id: 'git', name: 'git', kind: 'static', isDefault: true, config: { provider: 'github', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  assert.deepEqual(await gateway.getFile(site, 'posts/a.md'), { path: 'posts/a.md', content: 'old', revision: 'old-sha' }); await gateway.putFile(site, { path: SafeRelativePath.parse('posts/a.md'), content: 'new', warnings: [], framework: 'hexo' }, 'old-sha'); assert.equal(method, 'PUT'); assert.match(body, /old-sha/);
});

test('Git HTTP gateway propagates cancellation into an in-flight request', async () => {
  const controller = new AbortController();
  const gateway = new HttpGitGateway(undefined, async (_url, init) => await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }));
  const site = createStaticSite({ id: 'cancel-git', name: 'git', kind: 'static', isDefault: true, config: { provider: 'github', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const pending = gateway.getFile(site, 'posts/a.md', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/i);
});

test('GitLab and Gitee content endpoints decode provider-specific payloads', async () => {
  for (const provider of ['gitlab', 'gitee'] as const) {
    let requested = '';
    const gateway = new HttpGitGateway(async () => 'token', async (url) => {
      requested = String(url);
      return new Response(JSON.stringify({ content: Buffer.from(provider).toString('base64'), encoding: 'base64', sha: `${provider}-sha` }), { status: 200 });
    });
    const site = createStaticSite({ id: `git-${provider}`, name: provider, kind: 'static', isDefault: true, config: { provider, repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
    const file = await gateway.getFile(site, 'posts/a.md');
    assert.equal(file?.content, provider);
    assert.match(requested, provider === 'gitlab' ? /\/projects\/owner%2Frepo\/repository\/files/ : /\/repos\/owner\/repo\/contents/);
  }
});

test('Bitbucket gateway uses raw source reads, commit revisions and multipart writes', async () => {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const gateway = new HttpGitGateway(async () => 'token', async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body });
    if (init?.method === 'GET' && String(url).includes('/commits/')) return new Response(JSON.stringify({ values: [{ hash: 'bitbucket-sha' }] }), { status: 200 });
    if (init?.method === 'POST') return new Response(JSON.stringify({ commit: { hash: 'new-bitbucket-sha' } }), { status: 200 });
    return new Response('# Raw Bitbucket', { status: 200 });
  });
  const site = createStaticSite({ id: 'bitbucket', name: 'Bitbucket', kind: 'static', isDefault: true, config: { provider: 'bitbucket', repository: 'workspace/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const file = await gateway.getFile(site, 'posts/a.md');
  assert.deepEqual(file, { path: 'posts/a.md', content: '# Raw Bitbucket', revision: 'bitbucket-sha' });
  const result = await gateway.putFile(site, { path: SafeRelativePath.parse('posts/a.md'), content: '# Updated', warnings: [], framework: 'hexo' }, 'bitbucket-sha');
  assert.equal(result.revision, 'new-bitbucket-sha');
  assert.equal(calls.at(-1)?.method, 'POST');
  assert.ok(calls.at(-1)?.body instanceof FormData);
  await gateway.deleteFile(site, 'posts/a.md', 'bitbucket-sha');
  assert.equal(calls.at(-1)?.method, 'DELETE');
});
