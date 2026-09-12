import test from 'node:test';
import assert from 'node:assert/strict';
import { createCmsSite } from '../src/domain/site.ts';
import { TypechoFastApiCmsGateway, TypechoRestfulCmsGateway, TypechoSecureCmsGateway } from '../src/infrastructure/cms-gateways.ts';

const site = createCmsSite({ id: 'typecho', name: 'Typecho', kind: 'cms', isDefault: true, config: { cmsKind: 'typecho-fastapi', baseUrl: 'https://cms.test', ignoreSsl: false, adapterOptions: {} } });

test('Typecho API variants keep separate endpoint prefixes', async () => {
  const urls: string[] = [];
  const fetcher = async (url: string | URL) => { urls.push(String(url)); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); };
  await new TypechoSecureCmsGateway(undefined, fetcher).list(site, {});
  await new TypechoFastApiCmsGateway(undefined, fetcher).list(site, {});
  await new TypechoRestfulCmsGateway(undefined, fetcher).list(site, {});
  assert.match(urls[0], /\/api\/posts/);
  assert.match(urls[1], /\/api\/v1\/posts/);
  assert.match(urls[2], /\/api\/posts/);
});
