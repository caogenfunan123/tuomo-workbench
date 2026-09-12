import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath } from '../domain/values.ts';
import type { ImageHostGateway, ImageUploadResult } from '../application/content-tools.ts';
import type { GatewayRequestOptions } from '../application/ports.ts';
import { HttpJsonClient } from './http-client.ts';
import type { FetchLike } from './http-client.ts';

export type GitHubImageHostOptions = {
  repository: string;
  branch: string;
  directory?: string;
  apiBaseUrl?: string;
  commitMessage?: string;
  credentials?: () => Promise<Record<string, string>>;
};

export class GitHubImageHostGateway implements ImageHostGateway {
  private readonly options: GitHubImageHostOptions;
  private readonly client: HttpJsonClient;

  constructor(options: GitHubImageHostOptions, fetcher?: FetchLike) {
    this.options = options;
    this.client = new HttpJsonClient(fetcher);
  }

  async upload(bytes: Uint8Array, filename: string, mimeType: string, options: GatewayRequestOptions = {}): Promise<ImageUploadResult> {
    if (bytes.byteLength === 0 || !mimeType.trim()) throw new DomainError('validation', 'Image bytes and MIME type are required');
    const basename = filename.replaceAll('\\', '/').split('/').pop()?.trim() ?? '';
    if (!basename) throw new DomainError('validation', 'Image filename is required');
    const path = SafeRelativePath.parse(`${this.options.directory ?? 'images'}/${basename}`).value;
    const base = (this.options.apiBaseUrl ?? 'https://api.github.com').replace(/\/$/, '');
    const url = `${base}/repos/${this.options.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const headers = await this.options.credentials?.() ?? {};
    let sha: string | undefined;
    try {
      const current = await this.client.request<{ sha?: string }>(`${url}?ref=${encodeURIComponent(this.options.branch)}`, { headers }, options);
      sha = current.sha;
    } catch (error) {
      if (!(error instanceof DomainError) || error.kind !== 'notFound') throw error;
    }
    const value = await this.client.request<any>(url, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: this.options.commitMessage ?? `upload image ${basename}`,
        content: Buffer.from(bytes).toString('base64'),
        branch: this.options.branch,
        ...(sha ? { sha } : {}),
      }),
    }, options);
    const markdownUrl = String(value?.content?.download_url ?? value?.content?.html_url ?? '');
    if (!markdownUrl) throw new DomainError('network', 'GitHub image response does not contain a URL');
    return { markdownUrl, remoteId: String(value?.content?.sha ?? value?.commit?.sha ?? '') || undefined };
  }
}
