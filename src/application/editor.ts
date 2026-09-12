import { articleHash, updateArticle } from '../domain/article.ts';
import type { Article } from '../domain/article.ts';
import { clone, contentHash } from '../domain/values.ts';
import type { ArticleId } from '../domain/values.ts';

export type EditorStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';
export type DocumentSessionState = { article: Article; savedHash: string; status: EditorStatus; lastSavedRevision?: number };

export class DirtyTracker {
  private baseline = '';
  constructor(article: Article) { this.baseline = articleHash(article); }
  updateBaseline(article: Article): void { this.baseline = articleHash(article); }
  isDirty(article: Article): boolean { return this.baseline !== articleHash(article); }
}

export class DocumentSession {
  readonly id: ArticleId;
  private state: DocumentSessionState;
  private readonly dirtyTracker: DirtyTracker;
  constructor(article: Article) { this.id = article.id; this.state = { article: clone(article), savedHash: articleHash(article), status: 'clean', lastSavedRevision: article.localRevision }; this.dirtyTracker = new DirtyTracker(article); }
  get snapshot(): DocumentSessionState { return clone(this.state); }
  edit(patch: Parameters<typeof updateArticle>[1]): DocumentSessionState { this.state.article = updateArticle(this.state.article, patch); this.state.status = this.dirtyTracker.isDirty(this.state.article) ? 'dirty' : 'clean'; return this.snapshot; }
  markSaving(): void { this.state.status = 'saving'; }
  markSaved(revision: number): void { if (revision !== this.state.article.localRevision) return; this.state.savedHash = articleHash(this.state.article); this.state.lastSavedRevision = revision; this.state.status = 'saved'; this.dirtyTracker.updateBaseline(this.state.article); }
  markFailed(): void { this.state.status = 'failed'; }
}

export interface SessionRecoveryStore { save(session: DocumentSessionState): Promise<void>; load(articleId: ArticleId): Promise<DocumentSessionState | undefined>; remove(articleId: ArticleId): Promise<void>; }

export class InMemorySessionRecoveryStore implements SessionRecoveryStore {
  private readonly sessions = new Map<string, DocumentSessionState>();
  async save(session: DocumentSessionState): Promise<void> { this.sessions.set(session.article.id, clone(session)); }
  async load(articleId: ArticleId): Promise<DocumentSessionState | undefined> { const value = this.sessions.get(articleId); return value ? clone(value) : undefined; }
  async remove(articleId: ArticleId): Promise<void> { this.sessions.delete(articleId); }
}

export function sessionContentHash(session: DocumentSessionState): string { return contentHash({ id: session.article.id, article: session.article, savedHash: session.savedHash }); }
