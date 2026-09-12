import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createCmsSite, createStaticSite } from '../src/domain/site.ts';
import { SafeRelativePath, makeSecretRef } from '../src/domain/values.ts';
import { createEnvironmentCmsGateway, createEnvironmentStaticGateway, environmentSecretName } from '../src/infrastructure/runtime-gateways.ts';
import { HttpPublishSideEffects } from '../src/infrastructure/publish-side-effects.ts';

function restoreEnvironment(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test('runtime static gateway resolves SecretRef from environment without serializing it', async () => {
  const ref = makeSecretRef('credential', 'Git token', 'runtime_git_token');
  const name = environmentSecretName(ref);
  const previous = process.env[name];
  process.env[name] = 'runtime-token';
  try {
    let authorization = '';
    const gateway = createEnvironmentStaticGateway(async (_url, init) => {
      authorization = String(new Headers(init?.headers).get('authorization'));
      return new Response(JSON.stringify({ content: Buffer.from('remote').toString('base64'), encoding: 'base64', sha: 'remote-sha' }), { status: 200 });
    });
    const site = createStaticSite({ id: 'runtime-git', name: 'Runtime Git', kind: 'static', isDefault: true, config: { provider: 'github', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, credentialRef: ref, mirrors: [], hooks: [] } });
    const file = await gateway.getFile(site, 'posts/hello.md');
    assert.equal(file?.content, 'remote');
    assert.equal(authorization, 'Bearer runtime-token');
    assert.doesNotMatch(JSON.stringify(site), /runtime-token/);
  } finally {
    restoreEnvironment(name, previous);
  }
});

test('runtime CMS gateway routes protocol and auth scheme from public site config', async () => {
  const ref = makeSecretRef('credential', 'CMS token', 'runtime_cms_token');
  const name = environmentSecretName(ref);
  const previous = process.env[name];
  process.env[name] = 'cms-token';
  try {
    const requests: Array<{ url: string; authorization: string }> = [];
    const gateway = createEnvironmentCmsGateway(async (url, init) => {
      requests.push({ url: String(url), authorization: String(new Headers(init?.headers).get('authorization')) });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const site = createCmsSite({ id: 'runtime-cms', name: 'Runtime CMS', kind: 'cms', isDefault: true, config: { cmsKind: 'typecho-fastapi', baseUrl: 'https://cms.example.test', authRef: ref, ignoreSsl: false, adapterOptions: { authScheme: 'Basic' } } });
    await gateway.list(site, { limit: 1 });
    assert.match(requests[0].url, /\/api\/v1\/posts/);
    assert.equal(requests[0].authorization, 'Basic cms-token');
    assert.doesNotMatch(JSON.stringify(site), /cms-token/);
  } finally {
    restoreEnvironment(name, previous);
  }
});

test('publish side effects post structured mirror and deploy-hook payloads with cancellation', async () => {
  const requests: Array<{ url: string; body: string; idempotencyKey: string }> = [];
  const sideEffects = new HttpPublishSideEffects(async (url, init) => {
    requests.push({ url: String(url), body: String(init?.body ?? ''), idempotencyKey: String(new Headers(init?.headers).get('x-idempotency-key')) });
    return new Response('{}', { status: 202 });
  });
  const site = createStaticSite({ id: 'side-effects', name: 'Side effects', kind: 'static', isDefault: true, config: { provider: 'generic', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  await sideEffects.pushMirror(site, 'https://mirror.example.test/push', { path: SafeRelativePath.parse('posts/a.md'), content: '# A', warnings: [], framework: 'hexo' });
  await sideEffects.triggerHook(site, 'https://deploy.example.test/hook');
  assert.equal(requests.length, 2);
  assert.match(requests[0].body, /"kind":"mirror"/);
  assert.match(requests[1].body, /"kind":"deploy"/);
  assert.match(requests[0].idempotencyKey, /^[a-f0-9]{64}$/);
  assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey);
  await assert.rejects(() => sideEffects.triggerHook(site, 'http://deploy.example.test/hook'), (error: any) => error.kind === 'security');

  let calls = 0;
  const noReplay = new HttpPublishSideEffects(async () => {
    calls++;
    return new Response('{}', { status: 500 });
  });
  await assert.rejects(() => noReplay.triggerHook(site, 'https://deploy.example.test/hook'));
  assert.equal(calls, 1);
});
