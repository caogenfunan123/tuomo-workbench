import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteProvisioningUseCase } from '../src/application/provisioning.ts';
import { SiteWizardUseCase } from '../src/application/site-wizard.ts';

test('site provisioning executes steps and rolls back the repository on build failure', async () => {
  const actions: string[] = []; const useCase = new SiteProvisioningUseCase({ async createRepository() { actions.push('create'); return { id: 'r1', url: 'https://site.test' }; }, async writeFile(_id, path) { actions.push(`write:${path}`); }, async enablePages() { actions.push('pages'); }, async attachCloudflare() { actions.push('cloudflare'); return { projectId: 'p' }; }, async triggerBuild() { actions.push('build'); }, async waitForBuild() { return { ok: false }; }, async deleteRepository(id) { actions.push(`delete:${id}`); } });
  const result = await useCase.execute({ provider: 'github', owner: 'o', repository: 'r', framework: 'hexo', mode: 'pages', welcomePost: 'welcome', idempotencyKey: 'k' }); assert.equal(result.ok, false); assert.deepEqual(actions, ['create', 'write:README.md', 'write:.tuomo/framework.json', 'write:.github/workflows/tuomo-pages.yml', 'pages', 'write:posts/welcome.md', 'build', 'delete:r1']);
});

test('cloudflare provisioning triggers the returned deploy hook', async () => {
  const actions: string[] = [];
  const useCase = new SiteProvisioningUseCase({ async createRepository() { return { id: 'r2', url: 'https://site.test' }; }, async writeFile(_id, path) { actions.push(`write:${path}`); }, async enablePages() {}, async attachCloudflare() { actions.push('attach'); return { projectId: 'p', hook: 'hook-1' }; }, async triggerCloudflareHook(hook) { actions.push(`hook:${hook}`); }, async triggerBuild() { actions.push('build'); }, async waitForBuild() { return { ok: true, url: 'https://site.test' }; }, async deleteRepository() {} });
  const result = await useCase.execute({ provider: 'github', owner: 'o', repository: 'r', framework: 'astro', mode: 'cloudflare', welcomePost: 'welcome', idempotencyKey: 'k2' });
  assert.equal(result.ok, true);
  assert.deepEqual(actions, ['write:README.md', 'write:.tuomo/framework.json', 'write:.github/workflows/tuomo-pages.yml', 'attach', 'write:posts/welcome.md', 'hook:hook-1', 'build']);
});

test('site provisioning cancellation rolls back the created repository', async () => {
  const controller = new AbortController(); const actions: string[] = [];
  const useCase = new SiteProvisioningUseCase({
    async createRepository() { actions.push('create'); controller.abort(); return { id: 'cancelled-repo', url: 'https://site.test' }; },
    async writeFile() { actions.push('write'); },
    async enablePages() { actions.push('pages'); },
    async attachCloudflare() { return { projectId: 'project' }; },
    async triggerBuild() { actions.push('build'); },
    async waitForBuild() { return { ok: true }; },
    async deleteRepository(id) { actions.push(`delete:${id}`); },
  });
  const result = await useCase.execute({ provider: 'github', owner: 'o', repository: 'r', framework: 'hexo', mode: 'pages', welcomePost: 'welcome', idempotencyKey: 'cancel-key' }, controller.signal);
  assert.equal(result.ok, false);
  assert.deepEqual(actions, ['create', 'delete:cancelled-repo']);
});

test('site wizard reports completed steps independently of created resources', async () => {
  const result = await new SiteWizardUseCase().execute([
    { id: 'validate', run: async () => undefined },
    { id: 'write-config', run: async () => undefined },
    { id: 'build', run: async () => { throw new Error('build failed'); } },
  ]);
  assert.deepEqual(result.completed, ['validate', 'write-config']);
  assert.equal(result.ok, false);
});
