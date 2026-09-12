import test from 'node:test';
import assert from 'node:assert/strict';
import { createCmsSite } from '../src/domain/site.ts';
import type { CanonicalPost, CmsPost } from '../src/application/ports.ts';
import { GhostCmsGateway, TypechoFastApiCmsGateway, TypechoRestfulCmsGateway, TypechoSecureCmsGateway, WordPressCmsGateway } from '../src/infrastructure/cms-gateways.ts';

const post: CanonicalPost = { title: 'Contract', markdown: '# Body\n\nA contract body.', slug: 'contract', tags: ['one'], categories: ['notes'], status: 'draft', date: '2026-01-01T00:00:00Z' };

function mockCms(kind: 'wordpress' | 'ghost' | 'typecho') {
  const values = new Map<string, CmsPost>();
  let next = 1;
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const id = path.match(/\/([^/]+)\/?$/)?.[1];
    if (method === 'GET' && id && id !== 'posts') {
      const value = values.get(id);
      const shaped = kind === 'ghost' ? { ...value, updated_at: value?.revision } : kind === 'wordpress' ? { ...value, modified_gmt: value?.revision } : { ...value, updated_at: value?.revision };
      return response(kind === 'ghost' ? { posts: [shaped] } : shaped);
    }
    if (method === 'GET') {
      const list = [...values.values()].map((value) => kind === 'ghost' ? { ...value, updated_at: value.revision } : kind === 'wordpress' ? { ...value, modified_gmt: value.revision } : { ...value, updated_at: value.revision });
      return response(kind === 'ghost' ? { posts: list } : list);
    }
    if (method === 'POST') {
      const value: CmsPost = { id: String(next++), ...post, ...(kind === 'wordpress' ? { title: String(body.title), markdown: '# Body' } : {}), revision: 'r1', updatedAt: '2026-01-01T00:00:00Z' };
      values.set(value.id, value);
      return response(kind === 'ghost' ? { posts: [{ ...value, updated_at: 'r1' }] } : kind === 'wordpress' ? { ...value, modified_gmt: 'r1' } : { ...value, updated_at: 'r1' }, 201);
    }
    if (method === 'PUT') {
      assert.ok(id);
      const current = values.get(id);
      assert.ok(current);
      const value = { ...current, title: post.title, markdown: post.markdown, revision: 'r2', updatedAt: '2026-01-02T00:00:00Z' };
      values.set(id, value);
      return response(kind === 'ghost' ? { posts: [{ ...value, updated_at: 'r2' }] } : kind === 'wordpress' ? { ...value, modified_gmt: 'r2' } : { ...value, updated_at: 'r2' });
    }
    if (method === 'DELETE') {
      assert.ok(id);
      values.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response('not found', { status: 404 });
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('all CMS adapters satisfy the canonical CRUD contract', async () => {
  const cases: Array<{ name: string; kind: 'wordpress' | 'ghost' | 'typecho'; create: (fetcher: any) => any; siteKind: 'wordpress' | 'ghost' | 'typecho-secure' | 'typecho-fastapi' | 'typecho-restful' }> = [
    { name: 'wordpress', kind: 'wordpress', create: (fetcher) => new WordPressCmsGateway(undefined, fetcher), siteKind: 'wordpress' },
    { name: 'ghost', kind: 'ghost', create: (fetcher) => new GhostCmsGateway(undefined, fetcher), siteKind: 'ghost' },
    { name: 'typecho-secure', kind: 'typecho', create: (fetcher) => new TypechoSecureCmsGateway(undefined, fetcher), siteKind: 'typecho-secure' },
    { name: 'typecho-fastapi', kind: 'typecho', create: (fetcher) => new TypechoFastApiCmsGateway(undefined, fetcher), siteKind: 'typecho-fastapi' },
    { name: 'typecho-restful', kind: 'typecho', create: (fetcher) => new TypechoRestfulCmsGateway(undefined, fetcher), siteKind: 'typecho-restful' },
  ];
  for (const item of cases) {
    const site = createCmsSite({ id: item.name, name: item.name, kind: 'cms', isDefault: true, config: { cmsKind: item.siteKind, baseUrl: 'https://cms.example.test', ignoreSsl: false, adapterOptions: {} } });
    const gateway = item.create(mockCms(item.kind));
    const created = await gateway.create(site, post);
    assert.equal(created.id, '1', item.name);
    const listed = await gateway.list(site, { text: 'Contract' });
    assert.equal(listed.length, 1, item.name);
    const updated = await gateway.update(site, created.id, post, created.revision);
    assert.equal(updated.revision, 'r2', item.name);
    await gateway.delete(site, created.id);
    assert.deepEqual(await gateway.list(site, {}), [], item.name);
  }
});
