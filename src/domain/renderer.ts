import type { Article } from './article.ts';
import { FrontMatterCodec } from './front-matter.ts';
import type { StaticSite } from './site.ts';
import { SafeRelativePath } from './values.ts';

export type RenderedFile = { path: SafeRelativePath; content: string; warnings: string[]; framework: string };
export type TemplateResolver = (templateId: string, site: StaticSite) => string | undefined;
export type SlugStrategy = (value: string, article: Article) => string | undefined;

function offsetDate(iso: string, offsetMinutes: number): string {
  const date = new Date(iso);
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return shifted.toISOString().replace('T', ' ').replace('Z', '');
}

function dateOnly(iso: string, offsetMinutes: number): string { return offsetDate(iso, offsetMinutes).slice(0, 10); }

export function safeSlug(article: Article, strategy?: SlugStrategy): string {
  let candidate = article.metadata.slug?.trim() || article.title.trim();
  if (/[^\x00-\x7F]/.test(candidate)) candidate = strategy?.(candidate, article)?.trim() ?? '';
  if (!candidate || /[^\x00-\x7F]/.test(candidate)) return `post-${new Date(article.createdAt).getTime()}`;
  const slug = candidate.toLowerCase().replace(/[\\/:*?"<>|#%]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug || 'untitled';
}

function frameworkFrontMatter(framework: string, article: Article, date: string): Record<string, unknown> {
  const common = { title: article.title, date, tags: article.metadata.tags.length ? article.metadata.tags : undefined, categories: article.metadata.categories.length ? article.metadata.categories : undefined };
  switch (framework) {
    case 'hexo': return { ...common, type: article.metadata.kind };
    case 'hugo': return { title: article.title, date, draft: false, tags: common.tags, categories: common.categories };
    case 'jekyll': return { layout: article.metadata.kind === 'page' ? 'page' : 'post', title: article.title, date, tags: common.tags, categories: common.categories };
    case 'vuepress': return { title: article.title, date, permalink: article.metadata.slug };
    case 'gatsby': return { title: article.title, date, slug: article.metadata.slug };
    case 'nextjs': return { title: article.title, date, type: article.metadata.kind };
    case 'astro': return { title: article.title, pubDate: date, description: article.metadata.extraFrontMatter.description };
    case '11ty': return { title: article.title, date, tags: common.tags };
    case 'pelican': return { Title: article.title, Date: date, Tags: common.tags, Category: common.categories?.[0] };
    default: return common;
  }
}

export class FrameworkRenderer {
  private readonly codec: FrontMatterCodec;
  private readonly templateResolver?: TemplateResolver;
  private readonly slugStrategy?: SlugStrategy;
  constructor(codec = new FrontMatterCodec(), templateResolver?: TemplateResolver, slugStrategy?: SlugStrategy) { this.codec = codec; this.templateResolver = templateResolver; this.slugStrategy = slugStrategy; }

  render(article: Article, site: StaticSite, now = new Date()): RenderedFile {
    const config = site.config;
    const scheduled = article.scheduleAt ? new Date(article.scheduleAt) : undefined;
    const sourceDate = scheduled && scheduled.getTime() > now.getTime() ? scheduled.toISOString() : new Date(Math.min(new Date(article.createdAt).getTime(), now.getTime())).toISOString();
    const date = offsetDate(sourceDate, config.publishTimeZoneOffsetMinutes ?? 480);
    const base = article.metadata.kind === 'page' ? config.pagePath.value : config.postPath.value;
    const needsDatePrefix = config.framework === 'jekyll' || config.filenameRule === 'date-slug';
    const filename = `${needsDatePrefix ? `${dateOnly(sourceDate, config.publishTimeZoneOffsetMinutes ?? 480)}-` : ''}${safeSlug(article, this.slugStrategy)}.md`;
    const frontMatter = frameworkFrontMatter(config.framework, article, date);
    const merged = { ...article.metadata.extraFrontMatter, ...frontMatter };
    const warnings: string[] = [];
    const templateId = article.metadata.templateId ?? config.defaultTemplateId;
    const template = templateId && this.templateResolver ? this.templateResolver(templateId, site) : undefined;
    const rendered = template ? this.codec.fromArticle(article, config.framework, date, template) : { markdown: this.codec.encode(merged, article.body), warnings };
    return { path: SafeRelativePath.parse(`${base}/${filename}`), content: rendered.markdown, warnings: rendered.warnings, framework: config.framework };
  }
}
