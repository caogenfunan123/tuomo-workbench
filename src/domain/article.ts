import { assertDomain } from './errors.ts';
import { articleId, clone, contentHash, newId } from './values.ts';
import type { ArticleId, Revision } from './values.ts';

export type ArticleKind = 'post' | 'page';

export type ArticleMetadata = {
  tags: string[];
  categories: string[];
  cover?: string;
  kind: ArticleKind;
  templateId?: string;
  slug?: string;
  extraFrontMatter: Record<string, unknown>;
};

export type Article = {
  id: ArticleId;
  title: string;
  body: string;
  metadata: ArticleMetadata;
  localRevision: Revision;
  createdAt: string;
  updatedAt: string;
  volume?: string;
  scheduleAt?: string;
  published?: boolean;
};

export function normalizeList(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !seen.has(normalized)) { seen.add(normalized); result.push(normalized); }
  }
  return result;
}

export function createArticle(input: Partial<Omit<Article, 'id' | 'localRevision' | 'createdAt' | 'updatedAt'>> & { id?: string; now?: Date }): Article {
  const now = (input.now ?? new Date()).toISOString();
  const metadata = input.metadata ?? { tags: [], categories: [], kind: 'post' as const, extraFrontMatter: {} };
  const article: Article = {
    id: articleId(input.id ?? newId()),
    title: (input.title ?? '').trim(),
    body: input.body ?? '',
    metadata: {
      tags: normalizeList(metadata.tags ?? []),
      categories: normalizeList(metadata.categories ?? []),
      cover: metadata.cover?.trim() || undefined,
      kind: metadata.kind ?? 'post',
      templateId: metadata.templateId,
      slug: metadata.slug?.trim() || undefined,
      extraFrontMatter: clone(metadata.extraFrontMatter ?? {}),
    },
    localRevision: 1,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    volume: input.volume,
    scheduleAt: input.scheduleAt,
    published: input.published ?? false,
  };
  validateArticle(article);
  return article;
}

export function validateArticle(article: Article): void {
  assertDomain(/^[a-zA-Z0-9_-]{1,100}$/.test(article.id) && article.localRevision >= 1, 'Article identity/revision is invalid');
  assertDomain(article.metadata.kind === 'post' || article.metadata.kind === 'page', 'Article kind is invalid');
  assertDomain(!article.body.includes('\0'), 'Article body contains NUL');
  assertDomain(Number.isFinite(Date.parse(article.createdAt)) && Number.isFinite(Date.parse(article.updatedAt)), 'Article dates are invalid');
}

export function updateArticle(article: Article, patch: Partial<Pick<Article, 'title' | 'body' | 'volume' | 'scheduleAt' | 'published' | 'metadata'>>): Article {
  const next = createArticle({ ...clone(article), ...patch, id: article.id, now: new Date() });
  next.localRevision = article.localRevision + 1;
  next.createdAt = article.createdAt;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function articleHash(article: Article): string {
  return contentHash({ title: article.title, body: article.body, metadata: article.metadata, volume: article.volume, scheduleAt: article.scheduleAt });
}

export type ArticleSummary = Pick<Article, 'id' | 'title' | 'updatedAt' | 'localRevision' | 'published' | 'metadata'>;
