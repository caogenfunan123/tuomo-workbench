import { strict as assert } from 'node:assert';
import test from 'node:test';
import { ProviderBatchUploadGateway } from '../src/infrastructure/batch-upload-gateway.ts';

test('provider batch upload uses the GitHub Git Data chain', async () => {
  const requests: Array<{ method: string; url: string; body: string }> = [];
  const gateway = new ProviderBatchUploadGateway({ provider: 'github', repository: 'owner/repo', branch: 'main', token: 'token', apiBaseUrl: 'https://github.test' }, async (url, init) => {
    const method = String(init?.method ?? 'GET'); const value = String(url); const body = String(init?.body ?? ''); requests.push({ method, url: value, body });
    if (method === 'GET' && value.includes('/git/ref/heads/')) return new Response(JSON.stringify({ object: { sha: 'parent' } }), { status: 200 });
    if (method === 'POST' && value.endsWith('/git/blobs')) return new Response(JSON.stringify({ sha: 'blob-1' }), { status: 201 });
    if (method === 'POST' && value.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: 'tree-1' }), { status: 201 });
    if (method === 'POST' && value.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: 'commit-1' }), { status: 201 });
    if (method === 'PATCH' && value.includes('/git/refs/heads/')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 200 });
  });
  const result = await gateway.asUseCase().executeDetailed({ 'posts/a.md': new TextEncoder().encode('hello') });
  assert.deepEqual(result, { results: [{ path: 'posts/a.md', method: 'git-data' }], cancelled: false });
  assert.equal(requests.filter((request) => request.method === 'POST' && request.url.endsWith('/git/blobs')).length, 1);
  assert.match(requests.find((request) => request.url.endsWith('/git/blobs'))?.body ?? '', /aGVsbG8=/);
});

test('provider batch upload falls back to GitLab Contents after Git Data is unavailable', async () => {
  const requests: string[] = [];
  const gateway = new ProviderBatchUploadGateway({ provider: 'gitlab', repository: 'owner/repo', branch: 'main', apiBaseUrl: 'https://gitlab.test/api/v4' }, async (url, init) => {
    const method = String(init?.method ?? 'GET'); const value = String(url); requests.push(`${method} ${value}`);
    if (method === 'GET') return new Response('{}', { status: 404 });
    if (method === 'PUT') return new Response('{}', { status: 200 });
    return new Response('{}', { status: 200 });
  });
  const result = await gateway.asUseCase().executeDetailed({ 'posts/a.md': new TextEncoder().encode('hello') });
  assert.deepEqual(result, { results: [{ path: 'posts/a.md', method: 'contents' }], cancelled: false });
  assert.ok(requests.some((request) => request.startsWith('PUT ')));
});
