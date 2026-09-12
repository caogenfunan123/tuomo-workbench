import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonWritingLibraryStore } from '../src/infrastructure/json-writing-library.ts';

test('JSON writing library persists templates, snippets, volumes and stats atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-library-'));
  const path = join(root, 'writing', 'library.json');
  try {
    const store = new JsonWritingLibraryStore(path);
    const builtin = await store.saveTemplate({ id: 'builtin', name: 'Built-in', framework: 'hexo', kind: 'post', frontMatter: 'title: {{title}}', builtin: true });
    const custom = await store.saveTemplate({ id: builtin.id, name: 'Custom', framework: 'hexo', kind: 'post', frontMatter: 'title: {{title}}' });
    assert.notEqual(custom.id, builtin.id);
    const snippet = await store.saveSnippet({ name: '引用', body: '> 内容', tags: [' writing ', 'writing'] });
    const volume = await store.saveVolume({ name: '第一卷', articleIds: ['article-a', 'article-a'] });
    await store.addArticleToVolume(volume.id, 'article-b');
    await store.recomputeStats([{ body: '# 标题\n\nhello world' }, { body: '第二篇' }]);
    const snapshot = await store.read();
    assert.equal(snapshot.templates.length, 2);
    assert.deepEqual(snapshot.snippets[0].tags, ['writing']);
    assert.deepEqual(snapshot.volumes[0].articleIds, ['article-a', 'article-b']);
    assert.equal(snapshot.stats.articles, 2);

    const restored = new JsonWritingLibraryStore(path);
    assert.equal((await restored.read()).snippets[0].id, snippet.id);
    await restored.removeSnippet(snippet.id);
    await restored.removeVolume(volume.id);
    assert.equal((await restored.read()).snippets.length, 0);
    assert.equal((await restored.read()).volumes.length, 0);
    assert.match(await readFile(path, 'utf8'), /"schemaVersion": 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('JSON writing library protects built-in templates and unsafe ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-library-invalid-'));
  try {
    const store = new JsonWritingLibraryStore(join(root, 'library.json'));
    await store.saveTemplate({ id: 'builtin', name: 'Built-in', framework: 'hexo', kind: 'post', frontMatter: 'title: {{title}}', builtin: true });
    await assert.rejects(() => store.removeTemplate('builtin'), (error: any) => error.kind === 'unsupported');
    await assert.rejects(() => store.removeVolume('../escape'), (error: any) => error.kind === 'security');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
