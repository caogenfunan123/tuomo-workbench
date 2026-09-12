import test from 'node:test';
import assert from 'node:assert/strict';
import { createCmsSite } from '../src/domain/site.ts';
import { HttpCmsMediaGateway } from '../src/infrastructure/cms-gateways.ts';

const site = createCmsSite({ id: 'wordpress', name: 'WordPress', kind: 'cms', isDefault: true, config: { cmsKind: 'wordpress', baseUrl: 'https://cms.test', ignoreSsl: false, adapterOptions: {} } });

test('CMS media gateway uploads multipart bytes and maps the returned URL', async () => {
  let contentType = '';
  let bodyIsForm = false;
  const gateway = new HttpCmsMediaGateway(async () => ({ authorization: 'Bearer token' }), async (_url, init) => {
    contentType = String((init?.headers && (init.headers as Record<string, string>)['content-type']) ?? '');
    bodyIsForm = init?.body instanceof FormData;
    return new Response(JSON.stringify({ id: 3, source_url: 'https://cdn.test/image.png' }), { status: 201, headers: { 'content-type': 'application/json' } });
  });
  const result = await gateway.upload(site, new Uint8Array([1, 2, 3]), 'image.png', 'image/png');
  assert.equal(result.url, 'https://cdn.test/image.png');
  assert.equal(result.id, '3');
  assert.equal(bodyIsForm, true);
  assert.equal(contentType, '');
});

test('CMS media gateway forwards cancellation into the request', async () => {
  const controller = new AbortController();
  let forwarded = false;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const gateway = new HttpCmsMediaGateway(undefined, async (_url, init) => {
    markStarted();
    if (init?.signal?.aborted) { forwarded = true; throw new Error('aborted'); }
    await new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { forwarded = true; reject(new Error('aborted')); }, { once: true });
    });
    throw new Error('unreachable');
  });
  const pending = gateway.upload(site, new Uint8Array([1]), 'image.png', 'image/png', { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, (error: any) => error?.kind === 'cancelled');
  assert.equal(forwarded, true);
});
