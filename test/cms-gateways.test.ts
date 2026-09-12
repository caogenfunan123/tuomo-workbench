import test from 'node:test';
import assert from 'node:assert/strict';
import { createCmsSite } from '../src/domain/site.ts';
import { GhostCmsGateway, WordPressCmsGateway } from '../src/infrastructure/cms-gateways.ts';

const site = createCmsSite({ id: 'cms', name: 'cms', kind: 'cms', isDefault: true, config: { cmsKind: 'wordpress', baseUrl: 'https://cms.example.test', ignoreSsl: false, adapterOptions: {} } });

test('WordPress adapter maps canonical Markdown and CRUD payloads', async () => {
  let lastBody = ''; const gateway = new WordPressCmsGateway(async () => ({ authorization: 'Basic ***' }), async (_url, init) => { lastBody = String(init?.body ?? ''); if (init?.method === 'POST') return new Response(JSON.stringify({ id: 7, title: { rendered: 'Hello' }, content: { rendered: '<p>Body</p>' }, status: 'publish', modified_gmt: 'r1' }), { status: 200 }); return new Response(JSON.stringify([]), { status: 200 }); });
  const post = await gateway.create(site, { title: 'Hello', markdown: '# Body', tags: ['writing'], categories: ['notes'], status: 'published', date: '2026-01-01T00:00:00Z' }); assert.equal(post.id, '7'); assert.match(lastBody, /<h1/); assert.match(lastBody, /Body<\/h1>/); assert.match(lastBody, /"tags":\["writing"\]/); assert.match(lastBody, /"categories":\["notes"\]/);
});

test('Ghost adapter uses admin post envelope', async () => {
  const ghost = new GhostCmsGateway(undefined, async () => new Response(JSON.stringify({ posts: [{ id: 'g1', title: 'Ghost', html: '<p>Body</p>', status: 'draft', updated_at: 'r1' }] }), { status: 200 }));
  const posts = await ghost.list(createCmsSite({ ...site, id: 'ghost', config: { ...site.config, cmsKind: 'ghost' } }), {}); assert.equal(posts[0].id, 'g1'); assert.equal(posts[0].markdown, 'Body');
});

test('CMS adapters use the shared safe renderer for hostile HTML and URLs', async () => {
  let body = '';
  const gateway = new WordPressCmsGateway(undefined, async (_url, init) => {
    body = String(init?.body ?? '');
    const value = { id: 8, title: { rendered: 'Safe' }, content: { rendered: '<script>alert(1)</script><p>[x](javascript:alert(1))</p>' }, status: 'draft', modified_gmt: 'r2' };
    return new Response(JSON.stringify(init?.method === 'POST' ? value : [value]), { status: 200 });
  });
  const post = await gateway.create(site, { title: 'Safe', markdown: '[x](javascript:alert(1))', tags: [], categories: [], status: 'draft', date: '' });
  assert.equal(post.markdown, '[x](javascript:alert(1))');
  assert.doesNotMatch(body, /javascript:alert/);
  const listed = await gateway.list(site, {});
  assert.equal(listed[0].markdown, '[x](javascript:alert(1))');
});
