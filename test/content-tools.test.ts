import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchUploadUseCase, ImageHostUseCase, PreferencesStore, RssFeedService, checkLinks, checkLinksDetailed, findAndReplace, formatMarkdown, htmlToMarkdown, markdownStats, markdownToHtml, replaceLinks, spellCheck, tableOfContents } from '../src/application/content-tools.ts';
import { GitHubImageHostGateway } from '../src/infrastructure/github-image-host.ts';

test('Markdown utilities cover statistics, formatting, HTML conversion and link replacement', async () => {
  const markdown = '# Hi\n\n正文 https://old.test/x'; assert.equal(markdownStats(markdown).headings, 1); assert.equal(formatMarkdown(`${markdown}   `).endsWith('\n'), true); assert.match(markdownToHtml(markdown), /<h1 id="hi">/); assert.match(htmlToMarkdown('<h2>Back</h2><p>Text</p>'), /## Back/); assert.equal(replaceLinks(markdown, { 'https://old.test/x': 'https://new.test/x' }).includes('new.test'), true); assert.equal((await checkLinks(markdown, async (url) => ({ ok: url.includes('old') }))).filter((item) => item.ok).length, 1); assert.deepEqual(tableOfContents('# Hi\n## 子标题\n## 子标题').map((item) => item.anchor), ['hi', '子标题', '子标题-2']); assert.equal(findAndReplace('Hello hello', 'hello', '你好'), '你好 你好');
});

test('Markdown preview renders rich blocks without allowing script or unsafe URLs', () => {
  const html = markdownToHtml('## Rich\n\n```ts\nconst x = "<safe>";\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[bad](javascript:alert(1))\n\n$$x^2$$');
  assert.match(html, /<code class="language-ts">/);
  assert.match(html, /<table>/);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /math-block/);
  assert.match(html, /<h2 id="rich">/);
  assert.match(html, /&lt;safe&gt;/);
  assert.match(htmlToMarkdown('<script>alert(1)</script><p>safe</p>'), /safe/);
  assert.doesNotMatch(htmlToMarkdown('<script>alert(1)</script><p>safe</p>'), /alert/);
});

test('Markdown image syntax renders an image while ordinary links stay links', () => {
  const html = markdownToHtml('[link](https://example.test) ![alt](https://example.test/a.png)');
  assert.match(html, /<a href="https:\/\/example\.test"/);
  assert.match(html, /<img src="https:\/\/example\.test\/a\.png" alt="alt">/);
  assert.doesNotMatch(html, /<a href="https:\/\/example\.test\/a\.png"/);
});

test('RSS, image retry bytes and batch upload fallback are observable', async () => {
  const rss = await new RssFeedService(async () => '<rss><channel><item><title>A</title><link>https://a.test</link></item></channel></rss>').refresh('https://feed.test'); assert.equal(rss[0].title, 'A');
  const image = new ImageHostUseCase({ async upload() { throw new Error('offline'); } }); const failed = await image.execute(new Uint8Array([1]), 'a.png', 'image/png'); assert.equal(failed.ok, false); assert.equal(failed.retry.bytes[0], 1);
  const methods: string[] = []; const batch = await new BatchUploadUseCase(async () => { methods.push('data'); throw new Error('not supported'); }, async (path) => { methods.push(`contents:${path}`); throw new Error('not supported'); }, async (path) => { methods.push(`cli:${path}`); }).execute({ 'a.md': new Uint8Array([1]) }); assert.equal(batch[0].method, 'cli'); assert.deepEqual(methods, ['data', 'contents:a.md', 'cli:a.md']);
});

test('batch upload exposes cancellable partial progress with capped concurrency', async () => {
  const controller = new AbortController(); let active = 0; let peak = 0; let completed = 0;
  const batch = new BatchUploadUseCase(
    async () => { throw new Error('fallback'); },
    async () => { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active--; completed++; if (completed === 1) controller.abort(); },
    async () => { throw new Error('cli should not run in this case'); },
  );
  const result = await batch.executeDetailed({ 'a.md': new Uint8Array([1]), 'b.md': new Uint8Array([2]), 'c.md': new Uint8Array([3]) }, { concurrency: 2, signal: controller.signal });
  assert.equal(result.cancelled, true); assert.ok(result.results.length >= 1); assert.ok(peak <= 2);
});

test('link checking exposes partial results and cancellation', async () => {
  const controller = new AbortController(); let completed = 0; let peak = 0; let active = 0;
  const result = await checkLinksDetailed('https://a.test https://b.test https://c.test', async (url) => {
    active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 8)); active--; completed++; if (completed === 1) controller.abort(); return { ok: url.includes('a') };
  }, { concurrency: 8, signal: controller.signal });
  assert.equal(result.cancelled, true); assert.ok(result.results.length >= 1); assert.ok(peak <= 4);
});

test('preferences keep simple/standard visibility state without changing routes', () => { const store = new PreferencesStore(); store.update({ mode: 'standard', pinned: ['agent', 'agent'] }); assert.deepEqual(store.get().pinned, ['agent']); assert.equal(store.get().mode, 'standard'); });

test('spell checker ignores code and links and returns bounded suggestions', () => {
  const issues = spellCheck('Hello wrld `const wrld = 1` https://wrld.test', new Set(['hello', 'world', 'const']), { maxSuggestions: 1 });
  assert.deepEqual(issues.map((issue) => issue.word), ['wrld']);
  assert.deepEqual(issues[0].suggestions, ['world']);
});

test('GitHub image host creates and updates content files with safe paths', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = new GitHubImageHostGateway({ repository: 'owner/images', branch: 'main', directory: 'assets', credentials: async () => ({ authorization: 'Bearer token' }) }, async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify({ content: { download_url: 'https://raw.example/image.png', sha: 'sha-1' } }), { status: 201 });
  });
  const result = await gateway.upload(new Uint8Array([1, 2, 3]), '../image.png', 'image/png');
  assert.equal(result.markdownUrl, 'https://raw.example/image.png');
  assert.match(calls[1].url, /assets\/image.png/);
  assert.doesNotMatch(String(calls[1].init?.body), /token/);
});
