import test from 'node:test';
import assert from 'node:assert/strict';
import { importArticle } from '../src/application/import.ts';
import { exportArticle } from '../src/application/export.ts';
import { createArticle } from '../src/domain/article.ts';

test('Markdown, HTML and DOCX XML imports produce canonical articles', () => {
  assert.equal(importArticle({ format: 'markdown', filename: 'x.md', bytes: Buffer.from('---\ntitle: Front\n---\n\nBody') }).title, 'Front'); assert.match(importArticle({ format: 'html', filename: 'x.html', bytes: Buffer.from('<html><head><title>Web</title></head><body><h1>Hi</h1><p>Body</p></body></html>') }).body, /Hi/); assert.match(importArticle({ format: 'docx', filename: 'x.docx', bytes: Buffer.from('<w:document><w:t>Hello</w:t><w:t>World</w:t></w:document>') }).body, /Hello/);
  const source = createArticle({ title: 'DOCX', body: '第一段\n\n第二段 & 内容' });
  const roundTrip = importArticle({ format: 'docx', filename: 'round-trip.docx', bytes: exportArticle(source, 'docx').bytes });
  assert.match(roundTrip.body, /第一段/);
  assert.match(roundTrip.body, /第二段 & 内容/);
});

test('Markdown import/export preserves metadata and unknown front matter', () => {
  const imported = importArticle({ format: 'markdown', filename: 'page.md', bytes: Buffer.from('---\ntitle: Page\ntags: [one, two]\ncategories: docs\ntype: page\ncover: /cover.png\ntemplateId: custom\nunknown: keep\n---\n\nBody') });
  assert.equal(imported.metadata.kind, 'page');
  assert.deepEqual(imported.metadata.tags, ['one', 'two']);
  assert.deepEqual(imported.metadata.categories, ['docs']);
  assert.equal(imported.metadata.extraFrontMatter.unknown, 'keep');
  const exported = exportArticle(imported, 'markdown');
  assert.match(Buffer.from(exported.bytes).toString(), /unknown: keep/);
  assert.match(Buffer.from(exported.bytes).toString(), /type: page/);
});

test('Markdown metadata round-trip preserves publication scheduling fields', () => {
  const source = createArticle({
    title: 'Scheduled',
    body: 'Body',
    volume: '第一卷',
    scheduleAt: '2026-09-20T08:00:00.000Z',
    published: true,
    metadata: {
      tags: [],
      categories: [],
      kind: 'post',
      templateId: 'custom',
      slug: 'scheduled',
      extraFrontMatter: {},
    },
  });
  const restored = importArticle({
    format: 'markdown',
    filename: 'scheduled.md',
    bytes: exportArticle(source, 'markdown').bytes,
  });
  assert.equal(restored.volume, '第一卷');
  assert.equal(restored.scheduleAt, '2026-09-20T08:00:00.000Z');
  assert.equal(restored.published, true);
  assert.equal(restored.metadata.templateId, 'custom');
  assert.equal(restored.metadata.slug, 'scheduled');
});
