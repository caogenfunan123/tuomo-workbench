import type { Article } from '../domain/article.ts';
import { DomainError } from '../domain/errors.ts';
import type { ArticleQuery, ArticleRepository, ArticleSummary, AuditStore } from './ports.ts';

export type { ArticleRepository, ArticleQuery, ArticleSummary } from './ports.ts';

export type SaveState = 'saved' | 'stale' | 'failed';
export type SaveResult = { state: SaveState; articleId: string; revision: number; error?: unknown };

export class SaveDraftUseCase {
  private readonly repository: ArticleRepository;
  private readonly audit?: AuditStore;
  constructor(repository: ArticleRepository, audit?: AuditStore) { this.repository = repository; this.audit = audit; }

  async execute(article: Article, options: { expectedRevision?: number; exportMarkdown?: boolean; snapshot?: boolean } = {}): Promise<SaveResult> {
    try {
      await this.repository.put(article, options.expectedRevision ?? article.localRevision - 1);
      if (options.exportMarkdown ?? true) await this.repository.exportMarkdown(article);
      if (options.snapshot ?? true) await this.repository.snapshot(article);
      await this.audit?.append({ action: 'article.save', subject: article.id, details: { revision: article.localRevision } });
      return { state: 'saved', articleId: article.id, revision: article.localRevision };
    } catch (error) {
      if (error instanceof DomainError && error.kind === 'conflict') return { state: 'stale', articleId: article.id, revision: article.localRevision, error };
      await this.audit?.append({ action: 'article.save.failed', subject: article.id, details: { error: error instanceof Error ? error.message : String(error) } });
      return { state: 'failed', articleId: article.id, revision: article.localRevision, error };
    }
  }
}

export class SaveScheduler {
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; article: Article; expectedRevision: number }>();
  private readonly save: SaveDraftUseCase;
  private readonly debounceMs: number;
  constructor(save: SaveDraftUseCase, debounceMs = 500) { this.save = save; this.debounceMs = debounceMs; }

  schedule(article: Article, expectedRevision = article.localRevision - 1): void {
    const current = this.pending.get(article.id);
    if (current) clearTimeout(current.timer);
    const timer = setTimeout(() => { void this.flush(article.id); }, this.debounceMs);
    this.pending.set(article.id, { timer, article: structuredClone(article), expectedRevision: current?.expectedRevision ?? expectedRevision });
  }

  async flush(articleId: string): Promise<SaveResult | undefined> {
    const entry = this.pending.get(articleId);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.pending.delete(articleId);
    return this.save.execute(entry.article, { expectedRevision: entry.expectedRevision });
  }

  async flushAll(): Promise<SaveResult[]> {
    const ids = [...this.pending.keys()];
    const results = await Promise.all(ids.map((id) => this.flush(id)));
    return results.filter((result): result is SaveResult => Boolean(result));
  }
}
