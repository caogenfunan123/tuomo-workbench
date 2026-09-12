import test from 'node:test';
import assert from 'node:assert/strict';
import { SnippetStore, TemplateStore, VolumeStore, WritingStatsStore, suggestTags } from '../src/application/writing-library.ts';

test('templates, snippets, suggestions and stats are versioned/derived locally', () => { const templates = new TemplateStore([{ id: 'builtin', name: 'Builtin', framework: 'hexo', kind: 'post', frontMatter: '', version: 1, builtin: true }]); const copy = templates.save({ id: 'builtin', name: 'Custom', framework: 'hexo', kind: 'post', frontMatter: '', builtin: false }); assert.notEqual(copy.id, 'builtin'); const snippets = new SnippetStore(); const snippet = snippets.save({ name: 'intro', body: 'hello', tags: ['a', 'a'] }); assert.deepEqual(snippets.search('HELLO')[0].tags, ['a']); assert.deepEqual(suggestTags([{ tags: ['a'], categories: ['b'] }, { tags: ['a'], categories: [] }]), ['a', 'b']); const stats = new WritingStatsStore().recompute([{ body: 'hello world' }]); assert.equal(stats.articles, 1); });

test('volumes group articles without duplicate membership', () => {
  const store = new VolumeStore();
  const volume = store.save({ name: '第一卷', articleIds: ['a', 'a'] });
  assert.deepEqual(volume.articleIds, ['a']);
  assert.deepEqual(store.addArticle(volume.id, 'b').articleIds, ['a', 'b']);
  assert.deepEqual(store.removeArticle(volume.id, 'a').articleIds, ['b']);
});
