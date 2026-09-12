import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonSkillStore, JsonThemeRegistry } from '../src/infrastructure/json-skills-themes.ts';

test('JSON skill store persists user edits while protecting built-ins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-skills-'));
  try {
    const store = new JsonSkillStore(join(root, 'skills.json'), [{ id: 'builtin', name: '内置', description: '', prompt: 'read', enabled: true, version: 1, builtin: true }]);
    const skill = await store.create({ name: '用户技能', description: 'desc', prompt: 'write', enabled: true });
    const updated = await store.update(skill.id, { prompt: 'write carefully' });
    assert.equal(updated.version, 2);
    await assert.rejects(() => store.update('builtin', { prompt: 'mutate' }), (error: any) => error.kind === 'unsupported');
    const restored = new JsonSkillStore(join(root, 'skills.json'), [{ id: 'builtin', name: '内置', description: '', prompt: 'read', enabled: true, version: 1, builtin: true }]);
    assert.equal((await restored.list()).find((item) => item.id === skill.id)?.prompt, 'write carefully');
    await restored.remove(skill.id);
    assert.equal((await restored.list()).filter((item) => !item.builtin).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('JSON theme registry normalizes safe files and rejects traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-themes-'));
  try {
    const path = join(root, 'themes.json');
    const registry = new JsonThemeRegistry(path);
    await registry.install({ id: 'theme', name: '主题', framework: 'hexo', version: '1.0.0', files: [{ path: 'layout/index.ejs', content: '<main />' }], source: 'user' });
    const restored = new JsonThemeRegistry(path);
    assert.equal((await restored.get('theme'))?.files[0].path, 'layout/index.ejs');
    await assert.rejects(() => restored.install({ id: 'bad', name: 'bad', framework: 'hexo', version: '1', files: [{ path: '../escape', content: 'x' }], source: 'user' }), (error: any) => error.kind === 'security');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
