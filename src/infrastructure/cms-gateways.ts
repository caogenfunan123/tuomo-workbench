import { DomainError } from '../domain/errors.ts';
import type { CmsSite } from '../domain/site.ts';
import type { CanonicalPost, CmsPost, CmsPostGateway, GatewayRequestOptions, MediaGateway, MediaUploadResult, PostQuery } from '../application/ports.ts';
import { HttpJsonClient } from './http-client.ts';
import type { FetchLike } from './http-client.ts';
import { htmlToMarkdown as safeHtmlToMarkdown, markdownToHtml as safeMarkdownToHtml } from '../application/content-tools.ts';

export type CmsCredentialResolver = (site: CmsSite) => Promise<Record<string, string>>;

function revision(value: any): string { return String(value?.modified_gmt ?? value?.modified ?? value?.updated_at ?? value?.updatedAt ?? value?.id ?? ''); }

abstract class HttpCmsBase implements CmsPostGateway {
  protected readonly client: HttpJsonClient;
  protected readonly credential: CmsCredentialResolver;
  constructor(credential: CmsCredentialResolver = async () => ({}), fetcher?: FetchLike) { this.credential = credential; this.client = new HttpJsonClient(fetcher); }
  abstract list(site: CmsSite, query: PostQuery): Promise<CmsPost[]>;
  abstract create(site: CmsSite, post: CanonicalPost): Promise<CmsPost>;
  abstract update(site: CmsSite, id: string, post: CanonicalPost, expectedRevision?: string): Promise<CmsPost>;
  abstract delete(site: CmsSite, id: string): Promise<void>;
  protected async request<T>(site: CmsSite, path: string, init: RequestInit = {}, options: GatewayRequestOptions = {}): Promise<T> { const headers = await this.credential(site); return this.client.request<T>(`${site.config.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }, options); }
  protected ensureRevision(expected: string | undefined, current: string): void { if (expected && expected !== current) throw new DomainError('conflict', 'CMS remote revision mismatch'); }
}

export class WordPressCmsGateway extends HttpCmsBase {
  async list(site: CmsSite, query: PostQuery, options: GatewayRequestOptions = {}): Promise<CmsPost[]> { const params = new URLSearchParams({ per_page: String(query.limit ?? 100) }); if (query.text) params.set('search', query.text); if (query.status) params.set('status', query.status); const values = await this.request<any[]>(site, `/wp-json/wp/v2/posts?${params}`, {}, options); return values.map((value) => this.map(value)); }
  async create(site: CmsSite, post: CanonicalPost, options: GatewayRequestOptions = {}): Promise<CmsPost> { const value = await this.request<any>(site, '/wp-json/wp/v2/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.payload(post)) }, options); return this.map(value); }
  async update(site: CmsSite, id: string, post: CanonicalPost, expectedRevision?: string, options: GatewayRequestOptions = {}): Promise<CmsPost> { const current = await this.request<any>(site, `/wp-json/wp/v2/posts/${encodeURIComponent(id)}`, {}, options); this.ensureRevision(expectedRevision, revision(current)); const value = await this.request<any>(site, `/wp-json/wp/v2/posts/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.payload(post)) }, options); return this.map(value); }
  async delete(site: CmsSite, id: string, options: GatewayRequestOptions = {}): Promise<void> { await this.request(site, `/wp-json/wp/v2/posts/${encodeURIComponent(id)}?force=true`, { method: 'DELETE' }, options); }
  private payload(post: CanonicalPost): Record<string, unknown> { return { title: post.title, content: safeMarkdownToHtml(post.markdown), slug: post.slug, status: post.status, date: post.date, tags: post.tags, categories: post.categories }; }
  private map(value: any): CmsPost { return { id: String(value.id), title: String(value.title?.rendered ?? value.title ?? ''), markdown: safeHtmlToMarkdown(String(value.content?.rendered ?? value.content ?? '')), slug: value.slug, tags: Array.isArray(value.tags) ? value.tags.map(String) : [], categories: Array.isArray(value.categories) ? value.categories.map(String) : [], status: value.status === 'publish' ? 'published' : 'draft', date: String(value.date ?? value.date_gmt ?? new Date().toISOString()), revision: revision(value), updatedAt: String(value.modified_gmt ?? value.modified ?? new Date().toISOString()) }; }
}

export class GhostCmsGateway extends HttpCmsBase {
  async list(site: CmsSite, query: PostQuery, options: GatewayRequestOptions = {}): Promise<CmsPost[]> { const params = new URLSearchParams({ limit: String(query.limit ?? 100), formats: 'html,lexical' }); if (query.text) params.set('filter', `title:*${query.text}*`); const data = await this.request<any>(site, `/ghost/api/admin/posts/?${params}`, {}, options); return (data.posts ?? []).map((value: any) => this.map(value)); }
  async create(site: CmsSite, post: CanonicalPost, options: GatewayRequestOptions = {}): Promise<CmsPost> { const data = await this.request<any>(site, '/ghost/api/admin/posts/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ posts: [this.payload(post)] }) }, options); return this.map(data.posts?.[0]); }
  async update(site: CmsSite, id: string, post: CanonicalPost, expectedRevision?: string, options: GatewayRequestOptions = {}): Promise<CmsPost> { const currentData = await this.request<any>(site, `/ghost/api/admin/posts/${encodeURIComponent(id)}/`, {}, options); const current = currentData.posts?.[0]; this.ensureRevision(expectedRevision, revision(current)); const data = await this.request<any>(site, `/ghost/api/admin/posts/${encodeURIComponent(id)}/`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ posts: [{ ...this.payload(post), updated_at: current.updated_at }] }) }, options); return this.map(data.posts?.[0]); }
  async delete(site: CmsSite, id: string, options: GatewayRequestOptions = {}): Promise<void> { await this.request(site, `/ghost/api/admin/posts/${encodeURIComponent(id)}/`, { method: 'DELETE' }, options); }
  private payload(post: CanonicalPost): Record<string, unknown> { return { title: post.title, html: safeMarkdownToHtml(post.markdown), slug: post.slug, status: post.status === 'published' ? 'published' : 'draft', published_at: post.date, tags: post.tags.map((name) => ({ name })) }; }
  private map(value: any): CmsPost { return { id: String(value.id), title: String(value.title ?? ''), markdown: safeHtmlToMarkdown(String(value.html ?? value.lexical ?? '')), slug: value.slug, tags: (value.tags ?? []).map((tag: any) => String(tag.name ?? tag)), categories: (value.categories ?? []).map((category: any) => String(category.name ?? category)), status: value.status === 'published' ? 'published' : 'draft', date: String(value.published_at ?? value.created_at ?? new Date().toISOString()), revision: revision(value), updatedAt: String(value.updated_at ?? new Date().toISOString()) }; }
}

export class TypechoCmsGateway extends HttpCmsBase {
  private readonly prefix: string;
  constructor(credential?: CmsCredentialResolver, fetcher?: FetchLike, prefix = '/api/posts') { super(credential, fetcher); this.prefix = prefix; }
  async list(site: CmsSite, query: PostQuery, options: GatewayRequestOptions = {}): Promise<CmsPost[]> { const values = await this.request<any[]>(site, `${this.prefix}?limit=${query.limit ?? 100}${query.text ? `&search=${encodeURIComponent(query.text)}` : ''}`, {}, options); return values.map((value) => this.map(value)); }
  async create(site: CmsSite, post: CanonicalPost, options: GatewayRequestOptions = {}): Promise<CmsPost> { return this.map(await this.request(site, this.prefix, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(post) }, options)); }
  async update(site: CmsSite, id: string, post: CanonicalPost, expectedRevision?: string, options: GatewayRequestOptions = {}): Promise<CmsPost> { const current = this.map(await this.request(site, `${this.prefix}/${encodeURIComponent(id)}`, {}, options)); this.ensureRevision(expectedRevision, current.revision); return this.map(await this.request(site, `${this.prefix}/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(post) }, options)); }
  async delete(site: CmsSite, id: string, options: GatewayRequestOptions = {}): Promise<void> { await this.request(site, `${this.prefix}/${encodeURIComponent(id)}`, { method: 'DELETE' }, options); }
  private map(value: any): CmsPost { return { id: String(value.id ?? value.cid ?? value.post_id), title: String(value.title ?? ''), markdown: String(value.markdown ?? value.content ?? ''), slug: value.slug, tags: (value.tags ?? []).map(String), categories: (value.categories ?? []).map(String), status: value.status === 'publish' || value.status === 'published' ? 'published' : 'draft', date: String(value.date ?? value.created_at ?? new Date().toISOString()), revision: revision(value), updatedAt: String(value.updated_at ?? value.modified ?? new Date().toISOString()) }; }
}

export class HttpCmsMediaGateway implements MediaGateway {
  private readonly credential: CmsCredentialResolver;
  private readonly client: HttpJsonClient;
  constructor(credential: CmsCredentialResolver = async () => ({}), fetcher?: FetchLike) { this.credential = credential; this.client = new HttpJsonClient(fetcher); }
  async upload(site: CmsSite, bytes: Uint8Array, filename: string, mimeType: string, options: GatewayRequestOptions = {}): Promise<MediaUploadResult> {
    if (!filename.trim() || !mimeType.trim() || bytes.byteLength === 0) throw new DomainError('validation', 'Media filename, MIME type and bytes are required');
    const base = site.config.baseUrl.replace(/\/$/, '');
    const headers = await this.credential(site);
    let path: string;
    let init: RequestInit;
    if (site.config.cmsKind === 'wordpress') path = '/wp-json/wp/v2/media';
    else if (site.config.cmsKind === 'ghost') path = '/ghost/api/admin/images/upload/';
    else {
      path = String(site.config.adapterOptions.mediaPath ?? '/api/media');
      init = { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ filename, mimeType, data: Buffer.from(bytes).toString('base64') }) };
      return this.map(await this.client.request<any>(`${base}${path}`, init, options), mimeType);
    }
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeType }), filename);
    init = { method: 'POST', headers, body: form };
    return this.map(await this.client.request<any>(`${base}${path}`, init, options), mimeType);
  }
  private map(value: any, mimeType: string): MediaUploadResult {
    const url = String(value?.source_url ?? value?.url ?? value?.images?.[0]?.url ?? '');
    if (!url) throw new DomainError('network', 'CMS media response does not contain a URL');
    return { id: value?.id === undefined ? undefined : String(value.id), url, mimeType, revision: value?.modified ?? value?.updated_at };
  }
}

export class TypechoSecureCmsGateway extends TypechoCmsGateway { constructor(credential?: CmsCredentialResolver, fetcher?: FetchLike) { super(credential, fetcher, '/api/posts'); } }
export class TypechoFastApiCmsGateway extends TypechoCmsGateway { constructor(credential?: CmsCredentialResolver, fetcher?: FetchLike) { super(credential, fetcher, '/api/v1/posts'); } }
export class TypechoRestfulCmsGateway extends TypechoCmsGateway { constructor(credential?: CmsCredentialResolver, fetcher?: FetchLike) { super(credential, fetcher, '/api/posts'); } }
