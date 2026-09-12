import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticle } from '../src/domain/article.ts';
import { exportArticle } from '../src/application/export.ts';

test('export use case emits all requested document formats with safe filenames', () => {
  const article = createArticle({ title: '中文: Export', body: '# Heading\n\nBody' });
  for (const format of ['markdown', 'html', 'pdf', 'docx', 'epub', 'png'] as const) { const result = exportArticle(article, format); assert.match(result.filename, /^[^\\/:*?"<>|#%]+\.(md|html|pdf|docx|epub|png)$/); assert.ok(result.bytes.byteLength > 20); }
  assert.equal(Buffer.from(exportArticle(article, 'pdf').bytes).subarray(0, 5).toString(), '%PDF-'); assert.equal(Buffer.from(exportArticle(article, 'png').bytes).subarray(1, 4).toString(), 'PNG');
});
