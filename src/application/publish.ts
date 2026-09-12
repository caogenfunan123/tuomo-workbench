import type { Article } from '../domain/article.ts';
import { DomainError } from '../domain/errors.ts';
import { FrameworkRenderer } from '../domain/renderer.ts';
import type { RenderedFile } from '../domain/renderer.ts';
import type { CmsSite, StaticSite } from '../domain/site.ts';
import { contentHash } from '../domain/values.ts';
import type { ArticleRepository, AuditStore, BindingStore, CanonicalPost, CmsPostGateway, PublishSideEffectGateway, RemoteFile, StaticPublishGateway } from './ports.ts';

export type PreflightIssue = { level: 'error' | 'warning'; code: string; message: string };
export type StaticPreview = { siteId: string; siteName: string; file: RenderedFile; previous?: RemoteFile; diff: { changed: boolean; additions: number; deletions: number } ; issues: PreflightIssue[] };
export type PublishResult = { siteId: string; ok: boolean; revision?: string; error?: unknown; sideEffects?: Array<{ kind: 'mirror' | 'hook'; target: string; ok: boolean; error?: string }> };
export type BatchPublishResult = { previews: StaticPreview[]; results: PublishResult[]; cancelled: boolean };

function diff(oldContent: string | undefined, newContent: string): StaticPreview['diff'] {
  if (oldContent === newContent) return { changed: false, additions: 0, deletions: 0 };
  const oldLines = (oldContent ?? '').split('\n'); const newLines = newContent.split('\n');
  let additions = 0; let deletions = 0;
  const oldSet = new Set(oldLines); const newSet = new Set(newLines);
  for (const line of newLines) if (!oldSet.has(line)) additions++;
  for (const line of oldLines) if (!newSet.has(line)) deletions++;
  return { changed: true, additions, deletions };
}

function preflight(article: Article, site: StaticSite): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  if (!article.title.trim()) issues.push({ level: 'error', code: 'missing-title', message: '标题不能为空' });
  if (!article.body.trim()) issues.push({ level: 'error', code: 'empty-body', message: '正文不能为空' });
  if (article.body.trim().length > 0 && article.body.trim().length < 20) issues.push({ level: 'warning', code: 'short-body', message: '正文少于 20 个字符' });
  if (/https?:\/\/[^\s)]+\.(png|jpe?g|gif|webp)/i.test(article.body)) issues.push({ level: 'warning', code: 'external-image', message: '正文包含外链图片' });
  if (!site.config.repository.trim()) issues.push({ level: 'error', code: 'missing-repository', message: '站点仓库不能为空' });
  return issues;
}

async function mapConcurrent<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const output: R[] = new Array(items.length); let next = 0;
  async function consume(): Promise<void> { while (true) { if (signal?.aborted) throw new DomainError('cancelled', 'Publish cancelled'); const index = next++; if (index >= items.length) return; output[index] = await worker(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume())); return output;
}

async function mapConcurrentPartial<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>, signal?: AbortSignal): Promise<{ results: R[]; cancelled: boolean }> {
  const output: Array<R | undefined> = new Array(items.length); let next = 0; let cancelled = false;
  async function consume(): Promise<void> {
    while (true) {
      if (signal?.aborted) { cancelled = true; return; }
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()));
  return { results: output.filter((value): value is R => value !== undefined), cancelled };
}

export class StaticPublishUseCase {
  private readonly articles: ArticleRepository;
  private readonly gateway: StaticPublishGateway;
  private readonly renderer: FrameworkRenderer;
  private readonly bindings?: BindingStore;
  private readonly audit?: AuditStore;
  private readonly sideEffects?: PublishSideEffectGateway;
  constructor(articles: ArticleRepository, gateway: StaticPublishGateway, renderer = new FrameworkRenderer(), bindings?: BindingStore, audit?: AuditStore, sideEffects?: PublishSideEffectGateway) { this.articles = articles; this.gateway = gateway; this.renderer = renderer; this.bindings = bindings; this.audit = audit; this.sideEffects = sideEffects; }

  async preview(articleId: string, sites: StaticSite[], now = new Date(), signal?: AbortSignal): Promise<StaticPreview[]> {
    const article = await this.articles.get(articleId);
    if (!article) throw new DomainError('notFound', `Article not found: ${articleId}`);
    return mapConcurrent(sites, 4, async (site) => {
      const file = this.renderer.render(article, site, now);
      const previous = await this.gateway.getFile(site, file.path.value, { signal });
      return { siteId: site.id, siteName: site.name, file, previous, diff: diff(previous?.content, file.content), issues: preflight(article, site) };
    }, signal);
  }

  async publish(articleId: string, sites: StaticSite[], confirm: (previews: StaticPreview[]) => Promise<boolean> | boolean, now = new Date(), signal?: AbortSignal): Promise<PublishResult[]> {
    const previews = await this.preview(articleId, sites, now, signal);
    if (previews.some((item) => item.issues.some((issue) => issue.level === 'error'))) throw new DomainError('validation', 'Static publish preflight failed', { previews });
    if (!await confirm(previews)) throw new DomainError('cancelled', 'Publish cancelled by user');
    const article = await this.articles.get(articleId);
    if (!article) throw new DomainError('notFound', `Article not found: ${articleId}`);
    const results: PublishResult[] = [];
    for (const preview of previews) {
      if (signal?.aborted) throw new DomainError('cancelled', 'Publish cancelled');
      try {
        const latest = await this.gateway.getFile(sites.find((site) => site.id === preview.siteId)!, preview.file.path.value, { signal });
        if (latest?.revision !== preview.previous?.revision) throw new DomainError('conflict', `Remote file changed during preview: ${preview.file.path.value}`);
        const result = await this.gateway.putFile(sites.find((site) => site.id === preview.siteId)!, preview.file, latest?.revision, { signal });
        await this.bindings?.put({ siteId: preview.siteId as never, articleId, remotePath: result.path, remoteRevision: result.revision, baseContentHash: contentHash(preview.file.content), syncedAt: result.committedAt });
        const targetSite = sites.find((site) => site.id === preview.siteId)!; const sideEffects: PublishResult['sideEffects'] = [];
        for (const mirror of targetSite.config.mirrors) { try { if (!this.sideEffects) throw new DomainError('unsupported', 'Mirror gateway is not configured'); await this.sideEffects.pushMirror(targetSite, mirror, preview.file, { signal }); sideEffects.push({ kind: 'mirror', target: mirror, ok: true }); } catch (error) { sideEffects.push({ kind: 'mirror', target: mirror, ok: false, error: error instanceof Error ? error.message : String(error) }); } }
        for (const hook of targetSite.config.hooks) { try { if (!this.sideEffects) throw new DomainError('unsupported', 'Hook gateway is not configured'); await this.sideEffects.triggerHook(targetSite, hook, { signal }); sideEffects.push({ kind: 'hook', target: hook, ok: true }); } catch (error) { sideEffects.push({ kind: 'hook', target: hook, ok: false, error: error instanceof Error ? error.message : String(error) }); } }
        await this.audit?.append({ action: 'article.publish.static', subject: articleId, details: { siteId: preview.siteId, path: result.path, revision: result.revision, sideEffects } });
        results.push({ siteId: preview.siteId, ok: true, revision: result.revision, sideEffects });
      } catch (error) { results.push({ siteId: preview.siteId, ok: false, error }); }
    }
    return results;
  }

  async publishBatch(articleId: string, sites: StaticSite[], confirm: (previews: StaticPreview[]) => Promise<boolean> | boolean, now = new Date(), signal?: AbortSignal): Promise<BatchPublishResult> {
    const previews = await this.preview(articleId, sites, now, signal);
    if (previews.some((item) => item.issues.some((issue) => issue.level === 'error'))) {
      throw new DomainError('validation', 'Static publish preflight failed', { previews });
    }
    if (!await confirm(structuredClone(previews))) return { previews, results: [], cancelled: true };
    const article = await this.articles.get(articleId);
    if (!article) throw new DomainError('notFound', `Article not found: ${articleId}`);
    const byId = new Map(sites.map((site) => [site.id, site]));
    const published = await mapConcurrentPartial(previews, 4, async (preview) => {
      const site = byId.get(preview.siteId);
      if (!site) return { siteId: preview.siteId, ok: false, error: new DomainError('notFound', 'Publish site not found') };
      try {
        const latest = await this.gateway.getFile(site, preview.file.path.value, { signal });
        if (latest?.revision !== preview.previous?.revision) throw new DomainError('conflict', `Remote file changed during preview: ${preview.file.path.value}`);
        const result = await this.gateway.putFile(site, preview.file, latest?.revision, { signal });
        await this.bindings?.put({ siteId: site.id, articleId, remotePath: result.path, remoteRevision: result.revision, baseContentHash: contentHash(preview.file.content), syncedAt: result.committedAt });
        const sideEffects: PublishResult['sideEffects'] = [];
        for (const mirror of site.config.mirrors) {
          try { if (!this.sideEffects) throw new DomainError('unsupported', 'Mirror gateway is not configured'); await this.sideEffects.pushMirror(site, mirror, preview.file, { signal }); sideEffects.push({ kind: 'mirror', target: mirror, ok: true }); }
          catch (error) { sideEffects.push({ kind: 'mirror', target: mirror, ok: false, error: error instanceof Error ? error.message : String(error) }); }
        }
        for (const hook of site.config.hooks) {
          try { if (!this.sideEffects) throw new DomainError('unsupported', 'Hook gateway is not configured'); await this.sideEffects.triggerHook(site, hook, { signal }); sideEffects.push({ kind: 'hook', target: hook, ok: true }); }
          catch (error) { sideEffects.push({ kind: 'hook', target: hook, ok: false, error: error instanceof Error ? error.message : String(error) }); }
        }
        await this.audit?.append({ action: 'article.publish.static.batch', subject: articleId, details: { siteId: site.id, path: result.path, revision: result.revision, sideEffects } });
        return { siteId: site.id, ok: true, revision: result.revision, sideEffects };
      } catch (error) {
        await this.audit?.append({ action: 'article.publish.static.batch.failed', subject: articleId, details: { siteId: site.id, error: error instanceof Error ? error.message : String(error) } });
        return { siteId: site.id, ok: false, error };
      }
    }, signal);
    return { previews, results: published.results, cancelled: published.cancelled };
  }
}

export class CmsPublishUseCase {
  private readonly articles: ArticleRepository;
  private readonly gateway: CmsPostGateway;
  private readonly bindings?: BindingStore;
  private readonly audit?: AuditStore;
  constructor(articles: ArticleRepository, gateway: CmsPostGateway, bindings?: BindingStore, audit?: AuditStore) { this.articles = articles; this.gateway = gateway; this.bindings = bindings; this.audit = audit; }

  async publish(articleId: string, site: CmsSite, signal?: AbortSignal): Promise<PublishResult> {
    const article = await this.articles.get(articleId);
    if (!article) throw new DomainError('notFound', `Article not found: ${articleId}`);
    const binding = await this.bindings?.get(site.id, articleId);
    const post: CanonicalPost = { title: article.title, markdown: article.body, slug: article.metadata.slug, tags: article.metadata.tags, categories: article.metadata.categories, status: article.published ? 'published' : 'draft', date: article.scheduleAt ?? article.updatedAt };
    try {
      const remote = binding?.remoteId ? await this.gateway.update(site, binding.remoteId, post, binding.remoteRevision, { signal }) : await this.gateway.create(site, post, { signal });
      await this.bindings?.put({ siteId: site.id, articleId, remoteId: remote.id, remoteRevision: remote.revision, baseContentHash: contentHash({ title: article.title, markdown: article.body, slug: article.metadata.slug, tags: article.metadata.tags, categories: article.metadata.categories, status: article.published ? 'published' : 'draft', date: article.scheduleAt ?? article.updatedAt }), syncedAt: remote.updatedAt });
      await this.audit?.append({ action: 'article.publish.cms', subject: articleId, details: { siteId: site.id, remoteId: remote.id } });
      return { siteId: site.id, ok: true, revision: remote.revision };
    } catch (error) { await this.audit?.append({ action: 'article.publish.cms.failed', subject: articleId, details: { siteId: site.id, error: error instanceof Error ? error.message : String(error) } }); return { siteId: site.id, ok: false, error }; }
  }

  async publishMany(articleId: string, sites: CmsSite[], concurrency = 4, signal?: AbortSignal): Promise<PublishResult[]> {
    const published = await this.publishManyDetailed(articleId, sites, concurrency, signal);
    if (published.cancelled && published.results.length === 0 && signal?.aborted) throw new DomainError('cancelled', 'CMS publish cancelled before remote writes');
    return published.results;
  }

  async publishManyDetailed(articleId: string, sites: CmsSite[], concurrency = 4, signal?: AbortSignal): Promise<{ results: PublishResult[]; cancelled: boolean }> {
    const published = await mapConcurrentPartial(sites, Math.max(1, Math.min(4, concurrency)), async (site) => {
      try { return await this.publish(articleId, site, signal); }
      catch (error) { return { siteId: site.id, ok: false, error }; }
    }, signal);
    return published;
  }
}

export type CmsDeleteResult = { siteId: string; remoteId: string; ok: boolean; error?: unknown };
export type CmsDeleteBatchResult = { results: CmsDeleteResult[]; cancelled: boolean };

export class CmsArticleLifecycleUseCase {
  private readonly gateway: CmsPostGateway;
  private readonly audit?: AuditStore;
  constructor(gateway: CmsPostGateway, audit?: AuditStore) { this.gateway = gateway; this.audit = audit; }

  async delete(site: CmsSite, remoteId: string, signal?: AbortSignal): Promise<void> {
    if (!remoteId.trim()) throw new DomainError('validation', 'CMS remote id cannot be empty');
    await this.gateway.delete(site, remoteId, { signal });
    await this.audit?.append({ action: 'article.delete.cms', subject: remoteId, details: { siteId: site.id, remoteId } });
  }

  async deleteMany(items: Array<{ site: CmsSite; remoteId: string }>, concurrency = 4, signal?: AbortSignal): Promise<CmsDeleteResult[]> {
    return (await this.deleteManyDetailed(items, concurrency, signal)).results;
  }

  async deleteManyDetailed(items: Array<{ site: CmsSite; remoteId: string }>, concurrency = 4, signal?: AbortSignal): Promise<CmsDeleteBatchResult> {
    const published = await mapConcurrentPartial(items, Math.max(1, Math.min(4, concurrency)), async (item) => {
      try {
        await this.delete(item.site, item.remoteId, signal);
        return { siteId: item.site.id, remoteId: item.remoteId, ok: true };
      } catch (error) {
        await this.audit?.append({ action: 'article.delete.cms.failed', subject: item.remoteId, details: { siteId: item.site.id, remoteId: item.remoteId, error: error instanceof Error ? error.message : String(error) } });
        return { siteId: item.site.id, remoteId: item.remoteId, ok: false, error };
      }
    }, signal);
    return { results: published.results, cancelled: published.cancelled };
  }
}
