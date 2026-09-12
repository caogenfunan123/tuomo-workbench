import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateArticle } from '../domain/article.ts';
import type { Article, ArticleSummary } from '../domain/article.ts';
import { DomainError } from '../domain/errors.ts';
import { FrontMatterCodec } from '../domain/front-matter.ts';
import { SafeRelativePath, articleId } from '../domain/values.ts';
import type { ArticleQuery, ArticleRepository } from '../application/ports.ts';

export type SnapshotRecord = { article: Article; revision: number; createdAt: string };

async function readJson<T>(path: string, fallback: T): Promise<T> { try { return JSON.parse(await fs.readFile(path, 'utf8')) as T; } catch (error: any) { if (error.code === 'ENOENT') return fallback; throw error; } }

export class JsonArticleRepository implements ArticleRepository {
  readonly paths: { articles: string; index: string; exports: string; snapshots: string; trash: string };
  constructor(root: string) {
    this.paths = { articles: join(root, 'articles'), index: join(root, 'articles', 'index.json'), exports: join(root, 'exports', 'markdown'), snapshots: join(root, 'snapshots'), trash: join(root, 'trash') };
  }

  async init(): Promise<void> { await Promise.all(Object.values(this.paths).map((path) => fs.mkdir(path.endsWith('.json') ? dirname(path) : path, { recursive: true }))); if (!await this.exists(this.paths.index)) await this.atomicWrite(this.paths.index, '[]'); }
  async get(id: string): Promise<Article | undefined> { await this.init(); const safeId = articleId(id); const path = join(this.paths.articles, `${safeId}.json`); return readJson<Article | undefined>(path, undefined); }
  async list(query: ArticleQuery = {}): Promise<ArticleSummary[]> {
    await this.init(); const index = await readJson<ArticleSummary[]>(this.paths.index, []); const text = query.text?.toLowerCase();
    let candidates = index.filter((item) => query.published === undefined || item.published === query.published);
    if (text) {
      const matches = await Promise.all(candidates.map(async (item) => {
        const summaryText = `${item.title} ${item.metadata.tags.join(' ')} ${item.metadata.categories.join(' ')}`.toLowerCase();
        if (summaryText.includes(text)) return item;
        try {
          const safeId = articleId(item.id);
          const article = await readJson<Article | undefined>(join(this.paths.articles, `${safeId}.json`), undefined);
          return article && `${article.title}\n${article.body}\n${article.metadata.tags.join(' ')}\n${article.metadata.categories.join(' ')}`.toLowerCase().includes(text) ? item : undefined;
        } catch { return undefined; }
      }));
      candidates = matches.filter((item): item is ArticleSummary => Boolean(item));
    }
    return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, query.limit ?? Number.MAX_SAFE_INTEGER);
  }
  async put(article: Article, expectedRevision: number): Promise<void> {
    await this.init(); validateArticle(article); const current = await this.get(article.id);
    if ((current?.localRevision ?? 0) !== expectedRevision) throw new DomainError('conflict', `Article revision conflict: expected ${expectedRevision}, found ${current?.localRevision ?? 0}`);
    await this.atomicWrite(join(this.paths.articles, `${article.id}.json`), JSON.stringify(article, null, 2));
    const index = await readJson<ArticleSummary[]>(this.paths.index, []); const summary: ArticleSummary = { id: article.id, title: article.title, updatedAt: article.updatedAt, localRevision: article.localRevision, published: article.published, metadata: article.metadata };
    const next = [summary, ...index.filter((item) => item.id !== article.id)]; await this.atomicWrite(this.paths.index, JSON.stringify(next, null, 2));
  }
  async moveToTrash(id: string): Promise<void> { const safeId = articleId(id); await this.init(); const article = await this.get(safeId); if (!article) throw new DomainError('notFound', `Article not found: ${safeId}`); await this.atomicWrite(join(this.paths.trash, `${safeId}.json`), JSON.stringify({ article, deletedAt: new Date().toISOString() }, null, 2)); await fs.rm(join(this.paths.articles, `${safeId}.json`), { force: true }); const index = await this.list(); await this.atomicWrite(this.paths.index, JSON.stringify(index.filter((item) => item.id !== safeId), null, 2)); }
  async listTrash(): Promise<ArticleSummary[]> {
    await this.init();
    const values: ArticleSummary[] = [];
    for (const entry of await fs.readdir(this.paths.trash, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const item = await readJson<{ article?: Article } | undefined>(join(this.paths.trash, entry.name), undefined);
      if (!item?.article) continue;
      const article = item.article;
      values.push({ id: article.id, title: article.title, updatedAt: article.updatedAt, localRevision: article.localRevision, published: article.published, metadata: article.metadata });
    }
    return values.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  async restoreFromTrash(id: string): Promise<void> { const safeId = articleId(id); const item = await readJson<{ article: Article } | undefined>(join(this.paths.trash, `${safeId}.json`), undefined); if (!item) throw new DomainError('notFound', `Trash item not found: ${safeId}`); await this.put(item.article, (await this.get(safeId))?.localRevision ?? 0); await fs.rm(join(this.paths.trash, `${safeId}.json`), { force: true }); }
  async deleteTrash(id: string): Promise<void> { const safeId = articleId(id); await this.init(); await fs.rm(join(this.paths.trash, `${safeId}.json`), { force: true }); }
  async exportMarkdown(article: Article): Promise<void> {
    const safe = SafeRelativePath.parse(`${article.id}-${(article.title || 'untitled').replace(/[^\w\u4e00-\u9fff-]+/g, '-').slice(0, 80)}.md`);
    const markdown = new FrontMatterCodec().encode({
      ...article.metadata.extraFrontMatter,
      title: article.title,
      tags: article.metadata.tags.length ? article.metadata.tags : undefined,
      categories: article.metadata.categories.length ? article.metadata.categories : undefined,
      cover: article.metadata.cover,
      type: article.metadata.kind,
      templateId: article.metadata.templateId,
      slug: article.metadata.slug,
      volume: article.volume,
      scheduleAt: article.scheduleAt,
      published: article.published,
    }, article.body);
    await this.atomicWrite(join(this.paths.exports, safe.value), markdown);
  }
  async snapshot(article: Article): Promise<void> { await this.atomicWrite(join(this.paths.snapshots, article.id, `${article.localRevision}.json`), JSON.stringify(article, null, 2)); }
  async listSnapshots(id: string): Promise<SnapshotRecord[]> {
    const safeId = articleId(id);
    try {
      const entries = await fs.readdir(join(this.paths.snapshots, safeId), { withFileTypes: true });
      const values: SnapshotRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !/^\d+\.json$/.test(entry.name)) continue;
        const article = await readJson<Article | undefined>(join(this.paths.snapshots, safeId, entry.name), undefined);
        if (article) values.push({ article, revision: article.localRevision, createdAt: article.updatedAt });
      }
      return values.sort((left, right) => right.revision - left.revision);
    } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async restoreSnapshot(id: string, revision: number, expectedCurrentRevision: number): Promise<Article> {
    const safeId = articleId(id);
    const snapshot = await readJson<Article | undefined>(join(this.paths.snapshots, safeId, `${revision}.json`), undefined);
    if (!snapshot) throw new DomainError('notFound', `Snapshot not found: ${safeId}@${revision}`);
    const current = await this.get(safeId);
    if (!current) throw new DomainError('notFound', `Article not found: ${safeId}`);
    const restored: Article = { ...structuredClone(snapshot), id: safeId, localRevision: current.localRevision + 1, updatedAt: new Date().toISOString() };
    await this.put(restored, expectedCurrentRevision);
    await this.snapshot(restored);
    return restored;
  }
  async deleteSnapshot(id: string, revision: number): Promise<void> { const safeId = articleId(id); await fs.rm(join(this.paths.snapshots, safeId, `${revision}.json`), { force: true }); }
  async pruneSnapshots(id: string, keep = 20): Promise<number> { const snapshots = await this.listSnapshots(id); const removed = snapshots.slice(Math.max(0, keep)); for (const snapshot of removed) await this.deleteSnapshot(id, snapshot.revision); return removed.length; }

  private async exists(path: string): Promise<boolean> { try { await fs.access(path); return true; } catch { return false; } }
  private async atomicWrite(path: string, data: string): Promise<void> { const tmp = `${path}.${process.pid}.${Date.now()}.tmp`; await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(tmp, data, { flag: 'wx' }); await fs.rename(tmp, path); }
}
