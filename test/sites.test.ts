import test from 'node:test';
import assert from 'node:assert/strict';
import { createCmsSite, createStaticSite } from '../src/domain/site.ts';
import { SafeRelativePath } from '../src/domain/values.ts';
import { CmsConnectivityUseCase, InMemorySiteRegistry, SiteHealthMonitor } from '../src/application/sites.ts';
import { createHttpSiteCheck } from '../src/infrastructure/site-health.ts';
import { InMemoryCmsPostGateway } from '../src/infrastructure/memory-gateways.ts';

function makeSite(id: string, isDefault = false) { return createStaticSite({ id, name: id, kind: 'static', isDefault, config: { provider: 'generic', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } }); }

test('site registry keeps one default, supports switching and health aggregation', async () => {
  const registry = new InMemorySiteRegistry([makeSite('a', true), makeSite('b')]); registry.switchTo('b'); assert.equal(registry.active()?.id, 'b'); registry.update({ ...makeSite('b', true), name: 'B' }); assert.equal(registry.list().filter((site) => site.isDefault).length, 1);
  const health = await new SiteHealthMonitor(registry, async (site) => ({ reachable: site.id === 'b', pageNonEmpty: site.id === 'b' })).checkAll(); assert.deepEqual(health.map((item) => item.status).sort(), ['healthy', 'offline']);
});

test('CMS connectivity checks the adapter and returns a safe offline result', async () => {
  const cms = createCmsSite({ id: 'cms-health', name: 'CMS health', kind: 'cms', isDefault: true, config: { cmsKind: 'ghost', baseUrl: 'https://cms.example.test', ignoreSsl: false, adapterOptions: {} } });
  const registry = new InMemorySiteRegistry([cms]);
  const healthy = await new CmsConnectivityUseCase(registry, new InMemoryCmsPostGateway()).check(cms.id);
  assert.equal(healthy.reachable, true);
  const offline = await new CmsConnectivityUseCase(registry, { async list() { throw new Error('offline'); }, async create() { throw new Error('unused'); }, async update() { throw new Error('unused'); }, async delete() { throw new Error('unused'); } }).check(cms.id);
  assert.equal(offline.reachable, false);
  assert.match(offline.error!, /offline/);
});

test('HTTP site health check forwards cancellation to the underlying request', async () => {
  const site = { ...makeSite('cancel-health'), url: 'https://site.test' };
  const controller = new AbortController();
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const check = createHttpSiteCheck(async (_url, init) => {
    resolveStarted();
    await new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('test timeout')), 1_000);
      const onAbort = () => { clearTimeout(timer); reject(new Error('aborted')); };
      if (init?.signal?.aborted) onAbort();
      else init?.signal?.addEventListener('abort', onAbort, { once: true });
    });
    throw new Error('unreachable');
  });
  const pending = check(site, { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, (error: any) => error?.kind === 'cancelled');
});
