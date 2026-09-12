import type { Article, ArticleSummary } from '../domain/article.ts';
import type { CmsSite, RemoteBinding, Site, StaticSite } from '../domain/site.ts';
import type { RenderedFile } from '../domain/renderer.ts';
import type { SecretRef } from '../domain/values.ts';

export type ArticleQuery = { text?: string; published?: boolean; limit?: number };
export type GatewayRequestOptions = { signal?: AbortSignal; timeoutMs?: number; retries?: number };

export interface ArticleRepository {
  get(id: string): Promise<Article | undefined>;
  list(query?: ArticleQuery): Promise<ArticleSummary[]>;
  put(article: Article, expectedRevision: number): Promise<void>;
  moveToTrash(id: string): Promise<void>;
  listTrash(): Promise<ArticleSummary[]>;
  restoreFromTrash(id: string): Promise<void>;
  deleteTrash(id: string): Promise<void>;
  exportMarkdown(article: Article): Promise<void>;
  snapshot(article: Article): Promise<void>;
}

export type RemoteFile = { path: string; content: string; revision: string };
export type PutFileResult = { path: string; revision: string; committedAt: string };

export interface StaticPublishGateway {
  getFile(site: StaticSite, path: string, options?: GatewayRequestOptions): Promise<RemoteFile | undefined>;
  putFile(site: StaticSite, file: RenderedFile, expectedRevision?: string, options?: GatewayRequestOptions): Promise<PutFileResult>;
  deleteFile(site: StaticSite, path: string, expectedRevision: string, options?: GatewayRequestOptions): Promise<void>;
}

export interface PublishSideEffectGateway {
  pushMirror(site: StaticSite, mirror: string, file: RenderedFile, options?: GatewayRequestOptions): Promise<void>;
  triggerHook(site: StaticSite, hook: string, options?: GatewayRequestOptions): Promise<void>;
}

export type CanonicalPost = { title: string; markdown: string; slug?: string; tags: string[]; categories: string[]; status: 'draft' | 'published'; date: string };
export type CmsPost = CanonicalPost & { id: string; revision: string; updatedAt: string };
export type PostQuery = { text?: string; status?: CanonicalPost['status']; limit?: number };

export interface CmsPostGateway {
  list(site: CmsSite, query: PostQuery, options?: GatewayRequestOptions): Promise<CmsPost[]>;
  create(site: CmsSite, post: CanonicalPost, options?: GatewayRequestOptions): Promise<CmsPost>;
  update(site: CmsSite, id: string, post: CanonicalPost, expectedRevision?: string, options?: GatewayRequestOptions): Promise<CmsPost>;
  delete(site: CmsSite, id: string, options?: GatewayRequestOptions): Promise<void>;
}

export type MediaUploadResult = { id?: string; url: string; mimeType: string; revision?: string };
export interface MediaGateway {
  upload(site: CmsSite, bytes: Uint8Array, filename: string, mimeType: string, options?: GatewayRequestOptions): Promise<MediaUploadResult>;
}

export interface BindingStore {
  get(siteId: string, articleId: string): Promise<RemoteBinding | undefined>;
  put(binding: RemoteBinding): Promise<void>;
}

export interface SecretStore {
  put(value: string, ref?: SecretRef): Promise<SecretRef>;
  get(ref: SecretRef): Promise<string | undefined>;
  delete(ref: SecretRef): Promise<void>;
}

export interface AuditStore {
  append(event: { action: string; subject?: string; details?: Record<string, unknown> }): Promise<void>;
}

export interface SyncTransport {
  pull(options?: GatewayRequestOptions): Promise<{ objects: Record<string, { payload: string; revision: number; hash: string; modifiedAt: string }> }>;
  push(objects: Record<string, { payload: string; revision: number; hash: string; modifiedAt: string }>, options?: GatewayRequestOptions): Promise<void>;
}

export type SiteRegistry = { get(id: string): Site | undefined; list(): Site[]; active(): Site | undefined };
export type MutableSiteRegistry = SiteRegistry & { add(site: Site): void | Promise<void> };
