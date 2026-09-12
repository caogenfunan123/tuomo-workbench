import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath } from '../domain/values.ts';
import type { StaticSite } from '../domain/site.ts';
import type { RenderedFile } from '../domain/renderer.ts';
import type { FetchLike } from './http-client.ts';
import { HttpJsonClient } from './http-client.ts';
import type { GatewayRequestOptions, PutFileResult, RemoteFile, StaticPublishGateway } from '../application/ports.ts';

export type CredentialResolver = (site: StaticSite) => Promise<string | undefined>;

function encodePath(value: string): string { return value.split('/').map(encodeURIComponent).join('/'); }
function decodeContent(value: unknown, encoding?: string): string { if (encoding === 'base64') return Buffer.from(String(value).replaceAll('\n', ''), 'base64').toString('utf8'); return String(value ?? ''); }

export class HttpGitGateway implements StaticPublishGateway {
  private readonly client: HttpJsonClient;
  private readonly credential: CredentialResolver;
  constructor(credential: CredentialResolver = async () => undefined, fetcher?: FetchLike) { this.credential = credential; this.client = new HttpJsonClient(fetcher); }

  async getFile(site: StaticSite, path: string, options: GatewayRequestOptions = {}): Promise<RemoteFile | undefined> {
    const safe = SafeRelativePath.parse(path).value; const token = await this.credential(site); const url = this.fileUrl(site, safe);
    try {
      if (site.config.provider === 'bitbucket') {
        const response = await this.client.requestText(url, { method: 'GET', headers: this.headers(site, token) }, options);
        return { path: safe, content: response.body, revision: await this.bitbucketRevision(site, safe, token, options) };
      }
      const data = await this.client.request<any>(url, { method: 'GET', headers: this.headers(site, token) }, options);
      return { path: safe, content: decodeContent(data.content, data.encoding), revision: String(data.sha ?? data.last_commit_id ?? data.revision ?? '') };
    }
    catch (error) { if (error instanceof DomainError && error.kind === 'notFound') return undefined; throw error; }
  }

  async putFile(site: StaticSite, file: RenderedFile, expectedRevision?: string, options: GatewayRequestOptions = {}): Promise<PutFileResult> {
    const safe = SafeRelativePath.parse(file.path.value).value; const current = await this.getFile(site, safe, options); if ((current?.revision ?? undefined) !== expectedRevision) throw new DomainError('conflict', `Remote revision mismatch for ${safe}`);
    const token = await this.credential(site);
    if (site.config.provider === 'bitbucket') {
      const form = new FormData();
      form.append('branch', site.config.branch);
      form.append('message', site.config.commitMessage ?? `Update ${safe}`);
      form.append(safe, new Blob([file.content], { type: 'text/markdown' }), safe.split('/').pop() ?? 'untitled.md');
      const data = await this.client.request<any>(this.bitbucketSourceUrl(site), { method: 'POST', headers: this.headers(site, token), body: form }, options);
      const revision = String(data?.commit?.hash ?? data?.hash ?? await this.bitbucketRevision(site, safe, token, options));
      return { path: safe, revision, committedAt: new Date().toISOString() };
    }
    const body = site.config.provider === 'gitlab' ? { branch: site.config.branch, content: file.content, commit_message: site.config.commitMessage ?? `Update ${safe}`, ...(expectedRevision ? { last_commit_id: expectedRevision } : {}) } : { message: site.config.commitMessage ?? `Update ${safe}`, content: Buffer.from(file.content, 'utf8').toString('base64'), branch: site.config.branch, ...(expectedRevision ? { sha: expectedRevision } : {}) };
    const data = await this.client.request<any>(this.fileUrl(site, safe), { method: 'PUT', headers: { ...this.headers(site, token), 'content-type': 'application/json' }, body: JSON.stringify(body) }, options);
    const revision = String(data.content?.sha ?? data.last_commit_id ?? data.commit?.sha ?? data.revision ?? ''); return { path: safe, revision, committedAt: new Date().toISOString() };
  }

  async deleteFile(site: StaticSite, path: string, expectedRevision: string, options: GatewayRequestOptions = {}): Promise<void> {
    const safe = SafeRelativePath.parse(path).value; const current = await this.getFile(site, safe, options); if (!current || current.revision !== expectedRevision) throw new DomainError('conflict', `Remote revision mismatch for ${safe}`); const token = await this.credential(site);
    if (site.config.provider === 'bitbucket') {
      const url = `${this.fileUrl(site, safe)}?${new URLSearchParams({ branch: site.config.branch, message: `Delete ${safe}` })}`;
      await this.client.request(url, { method: 'DELETE', headers: this.headers(site, token) }, options);
      return;
    }
    const body = site.config.provider === 'gitlab' ? { branch: site.config.branch, commit_message: `Delete ${safe}`, last_commit_id: expectedRevision } : { message: `Delete ${safe}`, branch: site.config.branch, sha: expectedRevision }; await this.client.request(this.fileUrl(site, safe), { method: 'DELETE', headers: { ...this.headers(site, token), 'content-type': 'application/json' }, body: JSON.stringify(body), }, options);
  }

  private headers(site: StaticSite, token?: string): Record<string, string> { return { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(site.config.provider === 'github' ? { accept: 'application/vnd.github+json' } : {}) }; }
  private fileUrl(site: StaticSite, path: string): string {
    const base = (site.config.apiBaseUrl ?? ({ github: 'https://api.github.com', gitlab: 'https://gitlab.com/api/v4', gitee: 'https://gitee.com/api/v5', bitbucket: 'https://api.bitbucket.org/2.0', generic: '' } as Record<string, string>)[site.config.provider]).replace(/\/$/, '');
    if (site.config.provider === 'gitlab') return `${base}/projects/${encodeURIComponent(site.config.repository)}/repository/files/${encodePath(path)}?ref=${encodeURIComponent(site.config.branch)}`;
    if (site.config.provider === 'bitbucket') return `${base}/repositories/${site.config.repository}/src/${encodeURIComponent(site.config.branch)}/${encodePath(path)}`;
    return `${base}/repos/${site.config.repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(site.config.branch)}`;
  }

  private bitbucketSourceUrl(site: StaticSite): string {
    const base = (site.config.apiBaseUrl ?? 'https://api.bitbucket.org/2.0').replace(/\/$/, '');
    return `${base}/repositories/${site.config.repository}/src`;
  }

  private async bitbucketRevision(site: StaticSite, path: string, token: string | undefined, options: GatewayRequestOptions): Promise<string> {
    const base = (site.config.apiBaseUrl ?? 'https://api.bitbucket.org/2.0').replace(/\/$/, '');
    const url = `${base}/repositories/${site.config.repository}/commits/${encodeURIComponent(site.config.branch)}?${new URLSearchParams({ path, pagelen: '1' })}`;
    const data = await this.client.request<any>(url, { method: 'GET', headers: this.headers(site, token) }, options);
    return String(data?.values?.[0]?.hash ?? data?.values?.[0]?.commit?.hash ?? '');
  }
}
