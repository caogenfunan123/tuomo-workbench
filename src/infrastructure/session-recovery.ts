import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { articleId } from '../domain/values.ts';
import type { ArticleId } from '../domain/values.ts';
import type { DocumentSessionState, SessionRecoveryStore } from '../application/editor.ts';

export class JsonSessionRecoveryStore implements SessionRecoveryStore {
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  async save(session: DocumentSessionState): Promise<void> { await fs.mkdir(this.root, { recursive: true }); const path = this.path(session.article.id); const temporary = `${path}.${process.pid}.tmp`; await fs.writeFile(temporary, JSON.stringify(session, null, 2)); await fs.rename(temporary, path); }
  async load(articleId: ArticleId): Promise<DocumentSessionState | undefined> { try { return JSON.parse(await fs.readFile(this.path(articleId), 'utf8')) as DocumentSessionState; } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; } }
  async remove(articleId: ArticleId): Promise<void> { await fs.rm(this.path(articleId), { force: true }); }
  private path(id: string): string { return join(this.root, `${articleId(id)}.json`); }
}
