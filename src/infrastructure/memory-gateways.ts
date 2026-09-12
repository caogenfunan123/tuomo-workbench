import { createHash } from 'node:crypto';
import { DomainError } from '../domain/errors.ts';
import type { CmsPost, CmsPostGateway, PostQuery, PutFileResult, RemoteFile, StaticPublishGateway } from '../application/ports.ts';
import type { CmsSite, StaticSite } from '../domain/site.ts';
import type { RenderedFile } from '../domain/renderer.ts';

function rev(value: string): string { return createHash('sha1').update(value).digest('hex'); }

export class InMemoryStaticPublishGateway implements StaticPublishGateway {
  readonly files = new Map<string, RemoteFile>();
  private key(site: StaticSite, path: string): string { return `${site.id}:${path}`; }
  async getFile(site: StaticSite, path: string): Promise<RemoteFile | undefined> { const value = this.files.get(this.key(site, path)); return value ? { ...value } : undefined; }
  async putFile(site: StaticSite, file: RenderedFile, expectedRevision?: string): Promise<PutFileResult> { const key = this.key(site, file.path.value); const current = this.files.get(key); if (current?.revision !== expectedRevision) throw new DomainError('conflict', 'Remote revision mismatch'); const revision = rev(file.content); const committedAt = new Date().toISOString(); this.files.set(key, { path: file.path.value, content: file.content, revision }); return { path: file.path.value, revision, committedAt }; }
  async deleteFile(site: StaticSite, path: string, expectedRevision: string): Promise<void> { const key = this.key(site, path); const current = this.files.get(key); if (!current || current.revision !== expectedRevision) throw new DomainError('conflict', 'Remote revision mismatch'); this.files.delete(key); }
}

export class InMemoryCmsPostGateway implements CmsPostGateway {
  readonly posts = new Map<string, CmsPost>();
  private next = 1;
  async list(site: CmsSite, query: PostQuery): Promise<CmsPost[]> { return [...this.posts.values()].filter((post) => !query.text || `${post.title} ${post.markdown}`.toLowerCase().includes(query.text.toLowerCase())).filter((post) => !query.status || post.status === query.status).slice(0, query.limit ?? 100); }
  async create(_site: CmsSite, post: Omit<CmsPost, 'id' | 'revision' | 'updatedAt'>): Promise<CmsPost> { const value = { ...post, id: String(this.next++), revision: '1', updatedAt: new Date().toISOString() }; this.posts.set(value.id, value); return value; }
  async update(_site: CmsSite, id: string, post: Omit<CmsPost, 'id' | 'revision' | 'updatedAt'>, expectedRevision?: string): Promise<CmsPost> { const current = this.posts.get(id); if (!current) throw new DomainError('notFound', 'CMS post not found'); if (expectedRevision && current.revision !== expectedRevision) throw new DomainError('conflict', 'CMS revision mismatch'); const value = { ...post, id, revision: String(Number(current.revision) + 1), updatedAt: new Date().toISOString() }; this.posts.set(id, value); return value; }
  async delete(_site: CmsSite, id: string): Promise<void> { if (!this.posts.delete(id)) throw new DomainError('notFound', 'CMS post not found'); }
}
