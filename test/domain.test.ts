import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticle } from '../src/domain/article.ts';
import { FrontMatterCodec } from '../src/domain/front-matter.ts';
import { FrameworkRenderer } from '../src/domain/renderer.ts';
import { SafeRelativePath, makeSecretRef } from '../src/domain/values.ts';
import { createStaticSite } from '../src/domain/site.ts';
import { ALL_CAPABILITIES, featureFromRoute, missingCapabilities, visibleFeatures } from '../src/domain/navigation.ts';

test('SafeRelativePath rejects traversal, absolute paths and empty segments', () => {
  assert.equal(SafeRelativePath.parse('posts/hello.md').value, 'posts/hello.md');
  for (const path of ['../secret', '/etc/passwd', 'C:/secret', 'posts//x', 'posts/./x']) assert.throws(() => SafeRelativePath.parse(path));
});

test('FrontMatterCodec preserves unknown fields and body', () => {
  const codec = new FrontMatterCodec();
  const decoded = codec.decode('---\ntitle: Hello\ncustom: value\ntags: [one, two]\n---\n\nBody');
  assert.equal(decoded.data.custom, 'value');
  assert.deepEqual(decoded.data.tags, ['one', 'two']);
  assert.equal(decoded.body, 'Body');
  assert.match(codec.encode(decoded.data, decoded.body), /custom: value/);
});

test('all nine framework strategies produce safe Markdown paths', () => {
  const article = createArticle({ title: '中文 标题: demo', body: 'A sufficiently long body for a publish preview.', metadata: { tags: ['x'], categories: ['c'], kind: 'post', extraFrontMatter: {} }, createdAt: '2026-01-02T03:04:05.000Z' });
  const frameworks = ['hexo','hugo','jekyll','vuepress','gatsby','nextjs','astro','pelican','11ty'] as const;
  for (const framework of frameworks) {
    const site = createStaticSite({ name: framework, kind: 'static', isDefault: false, config: { provider: 'generic', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('source/_posts'), pagePath: SafeRelativePath.parse('source'), framework, publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
    const result = new FrameworkRenderer().render(article, site, new Date('2026-01-03T00:00:00.000Z'));
    assert.match(result.path.value, /\.md$/);
    assert.match(result.content, /title:/i);
  }
});

test('renderer accepts an optional slug strategy for non-ASCII titles', () => {
  const article = createArticle({ title: '你好 世界', body: 'A sufficiently long body for rendering.' });
  const site = createStaticSite({ name: 'slug', kind: 'static', isDefault: false, config: { provider: 'generic', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const rendered = new FrameworkRenderer(undefined, undefined, (value) => value === '你好 世界' ? 'ni-hao-shi-jie' : undefined).render(article, site);
  assert.match(rendered.path.value, /ni-hao-shi-jie\.md$/);
});

test('renderer resolves article templates and removes empty or unknown placeholder lines', () => {
  const article = createArticle({ title: 'Template', body: 'A sufficiently long body for rendering.', metadata: { tags: [], categories: [], kind: 'post', templateId: 'custom', extraFrontMatter: {} } });
  const site = createStaticSite({ name: 'template', kind: 'static', isDefault: false, config: { provider: 'generic', repository: 'owner/repo', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } });
  const result = new FrameworkRenderer(undefined, (id) => id === 'custom' ? 'title: {{title}}\ncover: {{cover}}\nunknown: {{missing}}' : undefined).render(article, site);
  assert.match(result.content, /title: Template/);
  assert.doesNotMatch(result.content, /cover:|unknown:/);
  assert.deepEqual(result.warnings, ['Unknown template placeholder: missing']);
});

test('navigation matrix covers every W/P/S/A/U capability from the guide', () => { assert.equal(missingCapabilities().length, 0); assert.equal(ALL_CAPABILITIES.length, 40); });

test('navigation registry resolves deep links without changing simple-mode permissions', () => {
  assert.equal(featureFromRoute('/publish/static?article=a')?.id, 'static-posts');
  assert.equal(featureFromRoute('/settings/')?.id, 'settings');
  assert.equal(featureFromRoute('/settings/extra'), undefined);
  assert.equal(featureFromRoute('/')?.id, 'home');
  assert.equal(visibleFeatures('simple').some((entry) => entry.id === 'batch-publish'), false);
  assert.equal(visibleFeatures('standard').some((entry) => entry.id === 'batch-publish'), true);
});

test('domain rejects unsafe secret references and invalid static configuration', () => {
  assert.throws(() => makeSecretRef('credential', 'bad', '../escape'), /Invalid secret reference/);
  assert.throws(() => createStaticSite({ id: 'invalid', name: 'invalid', kind: 'static', isDefault: false, config: { provider: 'generic', repository: 'o/r', branch: '', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } }), /branch/);
});
