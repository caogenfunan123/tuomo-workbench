import { strict as assert } from 'node:assert';
import test from 'node:test';
import { HttpProvisioningGateway } from '../src/infrastructure/provisioning-gateway.ts';

test('HTTP provisioning gateway creates GitHub repositories, writes idempotently and polls Pages', async () => {
  const requests: Array<{ method: string; url: string; headers: Headers; body: string }> = [];
  const gateway = new HttpProvisioningGateway({ githubApiBaseUrl: 'https://github.test', githubToken: 'secret', pollIntervalMs: 1 }, async (url, init) => {
    const request = { method: String(init?.method ?? 'GET'), url: String(url), headers: new Headers(init?.headers), body: String(init?.body ?? '') };
    requests.push(request);
    if (request.method === 'POST' && request.url.endsWith('/user/repos')) return new Response(JSON.stringify({ html_url: 'https://github.test/owner/site' }), { status: 201 });
    if (request.method === 'GET' && request.url.includes('/contents/')) return new Response('{}', { status: 404 });
    if (request.method === 'PUT' && request.url.includes('/contents/')) return new Response(JSON.stringify({ content: { sha: 'sha-1' } }), { status: 201 });
    if (request.method === 'POST' && request.url.endsWith('/pages')) return new Response('{}', { status: 201 });
    if (request.method === 'POST' && request.url.includes('/dispatches')) return new Response('{}', { status: 200 });
    if (request.method === 'GET' && request.url.endsWith('/pages')) return new Response(JSON.stringify({ status: 'built', html_url: 'https://owner.github.io/site' }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  const request = { provider: 'github' as const, owner: 'owner', repository: 'site', framework: 'hexo', mode: 'pages' as const, welcomePost: 'welcome', idempotencyKey: 'provision-1' };
  const repo = await gateway.createRepository(request);
  assert.equal(repo.id, 'github:owner/site');
  await gateway.writeFile(repo.id, 'posts/welcome.md', 'welcome', request.idempotencyKey);
  await gateway.enablePages(repo.id);
  await gateway.triggerBuild(repo.id);
  const result = await gateway.waitForBuild(repo.id, 100);
  assert.deepEqual(result, { ok: true, url: 'https://owner.github.io/site' });
  assert.equal(requests[0].headers.get('authorization'), 'Bearer secret');
  assert.equal(requests[0].headers.get('x-idempotency-key'), 'provision-1');
  assert.equal(requests.find((value) => value.method === 'PUT')?.headers.get('x-idempotency-key'), 'provision-1');
  assert.equal(requests.find((value) => value.url.endsWith('/pages'))?.headers.get('x-idempotency-key'), 'tuomo:enable-pages:github:owner/site');
  assert.equal(requests.find((value) => value.url.includes('/dispatches'))?.headers.get('x-idempotency-key'), 'tuomo:trigger-github-build:github:owner/site');
  assert.match(requests.find((value) => value.method === 'PUT')?.body ?? '', /welcome/);
});

test('HTTP provisioning gateway attaches Cloudflare with a configured account and rejects insecure hooks', async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const gateway = new HttpProvisioningGateway({ gitlabApiBaseUrl: 'https://gitlab.test/api/v4', cloudflareApiBaseUrl: 'https://cloudflare.test/client/v4', gitlabToken: 'gitlab-secret', cloudflareToken: 'cf-secret', cloudflareAccountId: 'account', pollIntervalMs: 1 }, async (url, init) => {
    const method = String(init?.method ?? 'GET'); const value = String(url); requests.push({ method, url: value });
    if (method === 'POST' && value.includes('/accounts/') && value.includes('/pages/projects')) return new Response(JSON.stringify({ result: { id: 'project-1' } }), { status: 200 });
    if (method === 'POST' && value.endsWith('/projects')) return new Response(JSON.stringify({ web_url: 'https://gitlab.test/owner/site' }), { status: 201 });
    if (method === 'GET' && value.includes('/repository/files/')) return new Response('{}', { status: 404 });
    if (method === 'PUT' && value.includes('/repository/files/')) return new Response('{}', { status: 200 });
    if (method === 'POST' && value.includes('/deployments')) return new Response('{}', { status: 200 });
    if (method === 'GET' && value.includes('/pages/projects/')) return new Response(JSON.stringify({ result: { url: 'https://pages.dev/site' } }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  const request = { provider: 'gitlab' as const, owner: 'owner', repository: 'site', framework: 'hugo', mode: 'cloudflare' as const, welcomePost: 'welcome', idempotencyKey: 'provision-2' };
  const repo = await gateway.createRepository(request);
  await gateway.writeFile(repo.id, 'README.md', 'readme', request.idempotencyKey);
  const project = await gateway.attachCloudflare(repo.id);
  assert.equal(project.projectId, 'project-1');
  await gateway.triggerBuild(repo.id);
  assert.deepEqual(await gateway.waitForBuild(repo.id, 100), { ok: true, url: 'https://pages.dev/site' });
  await assert.rejects(() => gateway.triggerCloudflareHook('http://unsafe.test/hook'), (error: any) => error.kind === 'security');
  assert.ok(requests.some((value) => value.url.includes('/accounts/account/pages/projects')));
});
