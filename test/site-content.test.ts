import test from 'node:test';
import assert from 'node:assert/strict';
import { SafeRelativePath } from '../src/domain/values.ts';
import { createCmsSite, createStaticSite } from '../src/domain/site.ts';
import { InMemorySiteRegistry } from '../src/application/sites.ts';
import { SiteContentQueryUseCase } from '../src/application/site-content.ts';
import { InMemoryCmsPostGateway } from '../src/infrastructure/memory-gateways.ts';

function staticSite(id: string) {
  return createStaticSite({ id, name: id, kind: 'static', isDefault: id === 'static-a', config: { provider: 'generic', repository: `${id}/repo`, branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
}

test('site content query aggregates static and CMS sources with filters', async () => {
  const cms = createCmsSite({ id: 'cms-a', name: 'CMS', kind: 'cms', isDefault: false, config: { cmsKind: 'wordpress', baseUrl: 'https://cms.test', ignoreSsl: false, adapterOptions: {} } });
  const registry = new InMemorySiteRegistry([staticSite('static-a'), cms]);
  const cmsGateway = new InMemoryCmsPostGateway();
  await cmsGateway.create(cms, { title: 'Remote post', markdown: 'body', tags: [], categories: [], status: 'published', date: '' });
  const query = new SiteContentQueryUseCase(registry, { cms: cmsGateway, static: { async list(site) { return [{ path: `${site.config.postPath.value}/hello.md`, title: 'Hello', content: 'local remote', revision: '1' }]; } } });
  const all = await query.list();
  assert.equal(all.length, 2);
  assert.deepEqual((await query.list({ kind: 'cms' })).map((item) => item.remoteId), ['1']);
  assert.equal((await query.list({ text: 'hello' }))[0].siteId, 'static-a');
});
