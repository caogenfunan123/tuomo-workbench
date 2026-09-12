import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStaticSite } from '../src/domain/site.ts';
import { SafeRelativePath } from '../src/domain/values.ts';
import { JsonSiteRegistry } from '../src/infrastructure/json-site-registry.ts';

test('JSON site registry persists lifecycle and never serializes path objects or credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-sites-'));
  const path = join(root, 'sites', 'registry.json');
  try {
    const registry = new JsonSiteRegistry(path);
    await registry.init();
    const site = createStaticSite({ id: 'blog', name: 'Blog', kind: 'static', isDefault: true, config: { provider: 'github', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('source/_posts'), pagePath: SafeRelativePath.parse('source'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [], credentialRef: { id: 'token-ref', kind: 'credential', label: 'Git token' } } });
    await registry.add(site);
    await registry.switchTo('blog');
    assert.equal(registry.active()?.id, 'blog');

    const restored = new JsonSiteRegistry(path);
    await restored.init();
    assert.equal(restored.get('blog')?.config.postPath.value, 'source/_posts');
    assert.equal(restored.active()?.id, 'blog');
    const stored = await readFile(path, 'utf8');
    assert.match(stored, /token-ref/);
    assert.doesNotMatch(stored, /Bearer|password|secret-value/);

    await restored.update({ ...restored.get('blog')!, name: 'Updated Blog', isDefault: true });
    assert.equal(restored.get('blog')?.name, 'Updated Blog');
    await restored.remove('blog');
    assert.equal(restored.list().length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
