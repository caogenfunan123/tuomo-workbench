import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath } from '../domain/values.ts';
import type { BatchUploadUseCase } from '../application/content-tools.ts';
import { BatchUploadUseCase as BatchUpload } from '../application/content-tools.ts';
import { HttpJsonClient } from './http-client.ts';
import type { FetchLike } from './http-client.ts';

export type BatchUploadGatewayOptions = {
  provider: 'github' | 'gitlab';
  repository: string;
  branch: string;
  token?: string;
  apiBaseUrl?: string;
  cliUpload?: (path: string, data: Uint8Array) => Promise<void>;
};

/** Provider-specific transport used by the application-owned fallback chain. */
export class ProviderBatchUploadGateway {
  private readonly options: BatchUploadGatewayOptions;
  private readonly client: HttpJsonClient;

  constructor(options: BatchUploadGatewayOptions, fetcher?: FetchLike) { this.options = options; this.client = new HttpJsonClient(fetcher); }

  asUseCase(): BatchUploadUseCase { return new BatchUpload((files) => this.gitData(files), (path, data) => this.contents(path, data), (path, data) => this.cli(path, data)); }

  async gitData(files: Record<string, Uint8Array>): Promise<void> {
    if (this.options.provider !== 'github') throw new DomainError('unsupported', 'Git Data batch upload is only available for GitHub');
    const base = this.base(); const headers = this.headers();
    const reference = await this.client.request<any>(`${base}/repos/${this.options.repository}/git/ref/heads/${encodeURIComponent(this.options.branch)}`, { headers }, {});
    const parent = String(reference?.object?.sha ?? '');
    if (!parent) throw new DomainError('network', 'Git provider did not return a branch revision');
    const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const [path, data] of Object.entries(files)) {
      const safe = SafeRelativePath.parse(path).value;
      const blob = await this.client.request<any>(`${base}/repos/${this.options.repository}/git/blobs`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ content: Buffer.from(data).toString('base64'), encoding: 'base64' }) }, {});
      const sha = String(blob?.sha ?? ''); if (!sha) throw new DomainError('network', `Git provider did not return a blob revision for ${safe}`);
      tree.push({ path: safe, mode: '100644', type: 'blob', sha });
    }
    const createdTree = await this.client.request<any>(`${base}/repos/${this.options.repository}/git/trees`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ base_tree: parent, tree }) }, {});
    const treeSha = String(createdTree?.sha ?? ''); if (!treeSha) throw new DomainError('network', 'Git provider did not return a tree revision');
    const commit = await this.client.request<any>(`${base}/repos/${this.options.repository}/git/commits`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Tuomo batch upload', tree: treeSha, parents: [parent] }) }, {});
    const commitSha = String(commit?.sha ?? ''); if (!commitSha) throw new DomainError('network', 'Git provider did not return a commit revision');
    await this.client.request(`${base}/repos/${this.options.repository}/git/refs/heads/${encodeURIComponent(this.options.branch)}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ sha: commitSha, force: false }) }, {});
  }

  async contents(path: string, data: Uint8Array): Promise<void> {
    const safe = SafeRelativePath.parse(path); const base = this.base(); const headers = this.headers(); let revision: string | undefined;
    const url = this.fileUrl(base, safe.value);
    try {
      const current = await this.client.request<any>(`${url}?ref=${encodeURIComponent(this.options.branch)}`, { headers }, {});
      revision = String(current?.sha ?? current?.last_commit_id ?? '') || undefined;
    } catch (error) { if (!(error instanceof DomainError) || error.kind !== 'notFound') throw error; }
    const body = this.options.provider === 'github'
      ? { message: `Tuomo upload ${safe.value}`, content: Buffer.from(data).toString('base64'), branch: this.options.branch, ...(revision ? { sha: revision } : {}) }
      : { branch: this.options.branch, content: Buffer.from(data).toString('utf8'), commit_message: `Tuomo upload ${safe.value}`, ...(revision ? { last_commit_id: revision } : {}) };
    await this.client.request(url, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }, {});
  }

  async cli(path: string, data: Uint8Array): Promise<void> {
    if (!this.options.cliUpload) throw new DomainError('unsupported', `CLI upload is not configured for ${path}`);
    await this.options.cliUpload(path, data);
  }

  private base(): string { return (this.options.apiBaseUrl ?? (this.options.provider === 'github' ? 'https://api.github.com' : 'https://gitlab.com/api/v4')).replace(/\/$/, ''); }
  private fileUrl(base: string, path: string): string {
    if (this.options.provider === 'github') return `${base}/repos/${this.options.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    return `${base}/projects/${encodeURIComponent(this.options.repository)}/repository/files/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  private headers(): Record<string, string> { return this.options.provider === 'github' ? { accept: 'application/vnd.github+json', ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}) } : { ...(this.options.token ? { 'private-token': this.options.token } : {}) }; }
}
