import { DomainError } from '../domain/errors.ts';
import type { StaticSite } from '../domain/site.ts';
import { SafeRelativePath } from '../domain/values.ts';
import { FetchJsonRequester } from './http-port.ts';
import type { FetchPort, JsonRequester } from './http-port.ts';
import type { AuditStore, GatewayRequestOptions, StaticPublishGateway } from './ports.ts';
import type { RenderedFile } from '../domain/renderer.ts';

export type RemoteArticle = { path: string; title?: string; content?: string; revision?: string; updatedAt?: string };
export type CommitEntry = { id: string; message: string; author?: string; at?: string };
export type RemoteArticleQuery = { text?: string; prefix?: string; limit?: number };
export type CredentialResolver = (site: StaticSite) => Promise<Record<string, string>>;

function encodePath(value: string): string { return value.split('/').map(encodeURIComponent).join('/'); }
function decodeContent(value: unknown, encoding?: string): string { return encoding === 'base64' ? Buffer.from(String(value).replaceAll('\n', ''), 'base64').toString('utf8') : String(value ?? ''); }

export class HttpRemoteArticleQuery {
  private readonly client: JsonRequester;
  private readonly credential: CredentialResolver;

  constructor(credential: CredentialResolver = async () => ({}), requesterOrFetcher?: JsonRequester | FetchPort) {
    this.credential = credential;
    this.client = typeof requesterOrFetcher === 'function' ? new FetchJsonRequester(requesterOrFetcher) : requesterOrFetcher ?? new FetchJsonRequester();
  }

  async list(site: StaticSite, query: RemoteArticleQuery = {}, options: GatewayRequestOptions = {}): Promise<RemoteArticle[]> {
    const headers = await this.credential(site);
    const prefix = query.prefix ?? site.config.postPath.value;
    const limit = Math.max(1, Math.min(500, Number.isFinite(query.limit) ? Number(query.limit) : 200));
    let values: any[];
    if (site.config.provider === 'gitlab') {
      values = await this.client.request<any[]>(`${this.base(site)}/projects/${encodeURIComponent(site.config.repository)}/repository/tree?path=${encodeURIComponent(prefix)}&recursive=true&ref=${encodeURIComponent(site.config.branch)}&per_page=${limit}`, { headers }, options);
    } else if (site.config.provider === 'bitbucket') {
      const data = await this.client.request<any>(this.bitbucketTreeUrl(site, prefix), { headers }, options);
      values = await this.walkBitbucket(site, data?.values ?? [], headers, limit, options);
    } else {
      values = await this.client.request<any[]>(`${this.base(site)}/repos/${site.config.repository}/contents/${encodePath(prefix)}?ref=${encodeURIComponent(site.config.branch)}`, { headers }, options);
      values = await this.walkContents(site, values, headers, limit, options);
    }
    const seen = new Set<string>();
    return values
      .filter((value) => String(value.path ?? value.name).toLowerCase().endsWith('.md'))
      .filter((value) => !query.text || String(value.path ?? value.name).toLowerCase().includes(query.text.toLowerCase()))
      .filter((value) => { const path = String(value.path ?? value.name); if (seen.has(path)) return false; seen.add(path); return true; })
      .slice(0, limit)
      .map((value) => ({ path: String(value.path ?? value.name), revision: value.sha ?? value.last_commit_id ?? value.commit?.hash }));
  }

  async get(site: StaticSite, path: string, revision = site.config.branch, options: GatewayRequestOptions = {}): Promise<RemoteArticle> {
    const safe = SafeRelativePath.parse(path).value;
    const headers = await this.credential(site);
    if (site.config.provider === 'bitbucket') {
      const value = await this.client.request<any>(this.bitbucketFileUrl(site, safe, revision), { headers }, options);
      const content = typeof value === 'string' ? value : decodeContent(value?.content, value?.encoding);
      return { path: safe, content, revision: await this.bitbucketRevision(site, safe, headers, options) };
    }
    const url = site.config.provider === 'gitlab'
      ? `${this.base(site)}/projects/${encodeURIComponent(site.config.repository)}/repository/files/${encodePath(safe)}?ref=${encodeURIComponent(revision)}`
      : `${this.base(site)}/repos/${site.config.repository}/contents/${encodePath(safe)}?ref=${encodeURIComponent(revision)}`;
    const value = await this.client.request<any>(url, { headers }, options);
    return { path: safe, content: decodeContent(value.content, value.encoding), revision: value.sha ?? value.last_commit_id };
  }

  async history(site: StaticSite, path: string, limit = 30, options: GatewayRequestOptions = {}): Promise<CommitEntry[]> {
    const safe = SafeRelativePath.parse(path).value;
    const headers = await this.credential(site);
    const bounded = Math.max(1, Math.min(100, limit));
    let values: any[];
    if (site.config.provider === 'gitlab') {
      values = await this.client.request<any[]>(`${this.base(site)}/projects/${encodeURIComponent(site.config.repository)}/repository/commits?path=${encodeURIComponent(safe)}&ref_name=${encodeURIComponent(site.config.branch)}&per_page=${bounded}`, { headers }, options);
    } else if (site.config.provider === 'bitbucket') {
      const data = await this.client.request<any>(`${this.base(site)}/repositories/${site.config.repository}/commits/${encodeURIComponent(site.config.branch)}?${new URLSearchParams({ path: safe, pagelen: String(bounded) })}`, { headers }, options);
      values = data?.values ?? [];
    } else {
      values = await this.client.request<any[]>(`${this.base(site)}/repos/${site.config.repository}/commits?path=${encodeURIComponent(safe)}&sha=${encodeURIComponent(site.config.branch)}&per_page=${bounded}`, { headers }, options);
    }
    return values.map((value) => ({ id: String(value.id ?? value.hash ?? value.sha), message: String(value.message ?? value.commit?.message ?? ''), author: value.author_name ?? value.commit?.author?.name ?? value.author?.raw, at: value.committed_date ?? value.commit?.author?.date ?? value.date }));
  }

  private async walkContents(site: StaticSite, initial: any[], headers: Record<string, string>, limit: number, options: GatewayRequestOptions): Promise<any[]> {
    const output: any[] = [];
    const queue = [...initial];
    const visited = new Set<string>();
    while (queue.length && output.length < limit) {
      const value = queue.shift();
      if (value.type === 'dir') {
        const directory = String(value.path);
        if (visited.has(directory)) continue;
        visited.add(directory);
        const children = await this.client.request<any[]>(`${this.base(site)}/repos/${site.config.repository}/contents/${encodePath(directory)}?ref=${encodeURIComponent(site.config.branch)}`, { headers }, options);
        queue.push(...children);
      } else output.push(value);
    }
    return output;
  }

  private async walkBitbucket(site: StaticSite, initial: any[], headers: Record<string, string>, limit: number, options: GatewayRequestOptions): Promise<any[]> {
    const output: any[] = [];
    const queue = [...initial];
    const visited = new Set<string>();
    while (queue.length && output.length < limit) {
      const value = queue.shift();
      const path = String(value.path ?? '');
      const directory = String(value.type ?? '').includes('directory') || value.type === 'dir';
      if (directory) {
        if (visited.has(path)) continue;
        visited.add(path);
        const data = await this.client.request<any>(this.bitbucketTreeUrl(site, path), { headers }, options);
        queue.push(...(data?.values ?? []));
      } else output.push(value);
    }
    return output;
  }

  private async bitbucketRevision(site: StaticSite, path: string, headers: Record<string, string>, options: GatewayRequestOptions): Promise<string> {
    const data = await this.client.request<any>(`${this.base(site)}/repositories/${site.config.repository}/commits/${encodeURIComponent(site.config.branch)}?${new URLSearchParams({ path, pagelen: '1' })}`, { headers }, options);
    return String(data?.values?.[0]?.hash ?? '');
  }

  private bitbucketTreeUrl(site: StaticSite, path: string): string { return `${this.base(site)}/repositories/${site.config.repository}/src/${encodeURIComponent(site.config.branch)}${path ? `/${encodePath(path)}` : ''}`; }
  private bitbucketFileUrl(site: StaticSite, path: string, revision: string): string { return `${this.base(site)}/repositories/${site.config.repository}/src/${encodeURIComponent(revision)}/${encodePath(path)}`; }
  private base(site: StaticSite): string { return (site.config.apiBaseUrl ?? ({ github: 'https://api.github.com', gitlab: 'https://gitlab.com/api/v4', gitee: 'https://gitee.com/api/v5', bitbucket: 'https://api.bitbucket.org/2.0', generic: '' } as Record<string, string>)[site.config.provider]).replace(/\/$/, ''); }
}

export class RemoteArticleCache {
  private readonly cache = new Map<string, { fingerprint: string; articles: RemoteArticle[]; cachedAt: string }>();
  get(key: string, fingerprint: string): RemoteArticle[] | undefined { const value = this.cache.get(key); return value?.fingerprint === fingerprint ? structuredClone(value.articles) : undefined; }
  put(key: string, fingerprint: string, articles: RemoteArticle[]): void { this.cache.set(key, { fingerprint, articles: structuredClone(articles), cachedAt: new Date().toISOString() }); }
  clear(): void { this.cache.clear(); }
}

export class RemoteArticleRollbackUseCase {
  private readonly reader: Pick<HttpRemoteArticleQuery, 'get'>;
  private readonly gateway: StaticPublishGateway;
  private readonly audit?: AuditStore;
  constructor(reader: Pick<HttpRemoteArticleQuery, 'get'>, gateway: StaticPublishGateway, audit?: AuditStore) { this.reader = reader; this.gateway = gateway; this.audit = audit; }

  async rollback(site: StaticSite, path: string, targetRevision: string, expectedCurrentRevision: string, options: GatewayRequestOptions = {}): Promise<{ path: string; revision: string }> {
    const safe = SafeRelativePath.parse(path).value;
    const current = await this.gateway.getFile(site, safe, options);
    if (!current || current.revision !== expectedCurrentRevision) throw new DomainError('conflict', `Remote file changed before rollback: ${safe}`);
    const historical = await this.reader.get(site, safe, targetRevision, options);
    const file: RenderedFile = { path: SafeRelativePath.parse(safe), content: historical.content ?? '', warnings: [], framework: 'remote-rollback' };
    const result = await this.gateway.putFile(site, file, expectedCurrentRevision, options);
    await this.audit?.append({ action: 'remote-file.rollback.history', subject: safe, details: { siteId: site.id, targetRevision, revision: result.revision } });
    return { path: result.path, revision: result.revision };
  }
}
