import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath } from '../domain/values.ts';
import type { GatewayRequestOptions } from '../application/ports.ts';
import type { ProvisionRequest, ProvisioningPort } from '../application/provisioning.ts';
import { HttpJsonClient } from './http-client.ts';
import type { FetchLike } from './http-client.ts';

export type ProvisioningGatewayOptions = {
  githubToken?: string;
  gitlabToken?: string;
  cloudflareToken?: string;
  cloudflareAccountId?: string;
  githubOwnerType?: 'user' | 'org';
  githubApiBaseUrl?: string;
  gitlabApiBaseUrl?: string;
  cloudflareApiBaseUrl?: string;
  pollIntervalMs?: number;
};

type RepositoryRef = { provider: ProvisionRequest['provider']; owner: string; name: string };

/**
 * Provider gateway for the one-click site wizard.
 *
 * It deliberately keeps the wizard's repository id opaque to the application
 * layer. The id is a provider-qualified ref, so rollback can address the same
 * repository without storing tokens or provider SDK objects in domain state.
 */
export class HttpProvisioningGateway implements ProvisioningPort {
  private readonly client: HttpJsonClient;
  private readonly options: ProvisioningGatewayOptions;
  private readonly cloudflareProjects = new Map<string, string>();

  constructor(options: ProvisioningGatewayOptions = {}, fetcher?: FetchLike) {
    this.options = options;
    this.client = new HttpJsonClient(fetcher);
  }

  async createRepository(request: ProvisionRequest, options: GatewayRequestOptions = {}): Promise<{ id: string; url: string }> {
    validateName(request.owner, 'owner'); validateName(request.repository, 'repository');
    const headers = this.headers(request.provider);
    let data: any;
    if (request.provider === 'github') {
      const ownerType = this.options.githubOwnerType ?? 'user';
      const endpoint = ownerType === 'org' ? `/orgs/${encodeURIComponent(request.owner)}/repos` : '/user/repos';
      data = await this.client.request<any>(`${this.githubBase()}${endpoint}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-idempotency-key': request.idempotencyKey }, body: JSON.stringify({ name: request.repository, private: false, auto_init: true, description: 'Created by Tuomo' }) }, options);
    } else {
      data = await this.client.request<any>(`${this.gitlabBase()}/projects`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-idempotency-key': request.idempotencyKey }, body: JSON.stringify({ name: request.repository, path: request.repository, namespace_id: this.gitlabNamespace(request.owner), visibility: 'public', description: 'Created by Tuomo' }) }, options);
    }
    const id = repositoryId(request.provider, request.owner, request.repository);
    const url = String(data?.html_url ?? data?.web_url ?? data?.http_url_to_repo ?? '');
    if (!url) throw new DomainError('network', 'Repository creation response does not contain a URL');
    return { id, url };
  }

  async writeFile(repositoryIdValue: string, path: string, content: string, idempotencyKey: string, options: GatewayRequestOptions = {}): Promise<void> {
    const safe = SafeRelativePath.parse(path).value; const ref = parseRepositoryId(repositoryIdValue); const headers = { ...this.headers(ref.provider), 'content-type': 'application/json', 'x-idempotency-key': idempotencyKey };
    if (ref.provider === 'github') {
      const url = `${this.githubBase()}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/contents/${encodePath(safe)}`;
      let sha: string | undefined;
      try { sha = String((await this.client.request<any>(`${url}?ref=main`, { headers: this.headers(ref.provider) }, options))?.sha ?? '') || undefined; } catch (error) { if (!(error instanceof DomainError) || error.kind !== 'notFound') throw error; }
      await this.client.request(url, { method: 'PUT', headers, body: JSON.stringify({ message: `Tuomo: write ${safe}`, content: Buffer.from(content, 'utf8').toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }) }, options);
      return;
    }
    const url = `${this.gitlabBase()}/projects/${encodeURIComponent(`${ref.owner}/${ref.name}`)}/repository/files/${encodePath(safe)}`;
    let lastCommitId: string | undefined;
    try { lastCommitId = String((await this.client.request<any>(`${url}?ref=main`, { headers: this.headers(ref.provider) }, options))?.last_commit_id ?? '') || undefined; } catch (error) { if (!(error instanceof DomainError) || error.kind !== 'notFound') throw error; }
    await this.client.request(url, { method: 'PUT', headers, body: JSON.stringify({ branch: 'main', content, commit_message: `Tuomo: write ${safe}`, ...(lastCommitId ? { last_commit_id: lastCommitId } : {}) }) }, options);
  }

  async enablePages(repositoryIdValue: string, options: GatewayRequestOptions = {}): Promise<void> {
    const ref = parseRepositoryId(repositoryIdValue);
    if (ref.provider === 'gitlab') return;
    await this.client.request(`${this.githubBase()}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pages`, { method: 'POST', headers: { ...this.headers(ref.provider), 'content-type': 'application/json', 'x-idempotency-key': operationKey(repositoryIdValue, 'enable-pages') }, body: JSON.stringify({ source: { branch: 'main', path: '/' } }) }, options);
  }

  async attachCloudflare(repositoryIdValue: string, options: GatewayRequestOptions = {}): Promise<{ projectId: string; hook?: string }> {
    const ref = parseRepositoryId(repositoryIdValue); const account = this.cloudflareAccount();
    const data = await this.client.request<any>(`${this.cloudflareBase()}/accounts/${encodeURIComponent(account)}/pages/projects`, { method: 'POST', headers: { ...this.headers('cloudflare'), 'content-type': 'application/json', 'x-idempotency-key': operationKey(repositoryIdValue, 'attach-cloudflare') }, body: JSON.stringify({ name: ref.name, production_branch: 'main', source: { type: ref.provider, config: { owner: ref.owner, repo_name: ref.name, production_branch: 'main' } } }) }, options);
    const projectId = String(data?.result?.id ?? data?.id ?? ref.name);
    this.cloudflareProjects.set(repositoryIdValue, projectId);
    const hook = typeof data?.result?.deployment_hook === 'string' ? data.result.deployment_hook : typeof data?.deployment_hook === 'string' ? data.deployment_hook : undefined;
    return { projectId, ...(hook ? { hook } : {}) };
  }

  async triggerCloudflareHook(hook: string, options: GatewayRequestOptions = {}): Promise<void> {
    if (!/^https:\/\//i.test(hook)) throw new DomainError('security', 'Cloudflare deployment hook must use HTTPS');
    await this.client.request(hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-idempotency-key': operationKey(hook, 'cloudflare-hook') }, body: '{}' }, { ...options, retries: 0 });
  }

  async triggerBuild(repositoryIdValue: string, options: GatewayRequestOptions = {}): Promise<void> {
    const ref = parseRepositoryId(repositoryIdValue); const project = this.cloudflareProjects.get(repositoryIdValue);
    if (project) {
      await this.client.request(`${this.cloudflareBase()}/accounts/${encodeURIComponent(this.cloudflareAccount())}/pages/projects/${encodeURIComponent(project)}/deployments`, { method: 'POST', headers: { ...this.headers('cloudflare'), 'content-type': 'application/json', 'x-idempotency-key': operationKey(repositoryIdValue, 'trigger-cloudflare-build') }, body: JSON.stringify({ branch: 'main' }) }, options);
      return;
    }
    if (ref.provider === 'github') {
      await this.client.request(`${this.githubBase()}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/workflows/tuomo-pages.yml/dispatches`, { method: 'POST', headers: { ...this.headers(ref.provider), 'content-type': 'application/json', 'x-idempotency-key': operationKey(repositoryIdValue, 'trigger-github-build') }, body: JSON.stringify({ ref: 'main' }) }, options);
    } else {
      await this.client.request(`${this.gitlabBase()}/projects/${encodeURIComponent(`${ref.owner}/${ref.name}`)}/pipeline`, { method: 'POST', headers: { ...this.headers(ref.provider), 'content-type': 'application/json', 'x-idempotency-key': operationKey(repositoryIdValue, 'trigger-gitlab-build') }, body: JSON.stringify({ ref: 'main' }) }, options);
    }
  }

  async waitForBuild(repositoryIdValue: string, timeoutMs: number, options: GatewayRequestOptions = {}): Promise<{ ok: boolean; url?: string }> {
    const started = Date.now(); const interval = Math.max(50, this.options.pollIntervalMs ?? 1_500);
    while (Date.now() - started <= timeoutMs) {
      if (options.signal?.aborted) throw new DomainError('cancelled', 'Site build polling cancelled');
      const ref = parseRepositoryId(repositoryIdValue); const project = this.cloudflareProjects.get(repositoryIdValue);
      const data = project
        ? await this.client.request<any>(`${this.cloudflareBase()}/accounts/${encodeURIComponent(this.cloudflareAccount())}/pages/projects/${encodeURIComponent(project)}`, { headers: this.headers('cloudflare') }, options)
        : ref.provider === 'github'
          ? await this.client.request<any>(`${this.githubBase()}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pages`, { headers: this.headers(ref.provider) }, options)
          : await this.client.request<any>(`${this.gitlabBase()}/projects/${encodeURIComponent(`${ref.owner}/${ref.name}`)}/pages`, { headers: this.headers(ref.provider) }, options);
      const status = String(data?.result?.deployment?.latest_stage?.status ?? data?.result?.latest_deployment?.stage?.status ?? data?.status ?? data?.build_status ?? '').toLowerCase();
      const url = String(data?.result?.domains?.[0]?.name ?? data?.result?.url ?? data?.html_url ?? data?.url ?? data?.web_url ?? '') || undefined;
      if (status === 'built' || status === 'success' || status === 'successful' || (url && !['building', 'queued', 'pending', 'running'].includes(status))) return { ok: true, ...(url ? { url: normalizeUrl(url) } : {}) };
      await delayWithCancellation(interval, options.signal);
    }
    return { ok: false };
  }

  async deleteRepository(repositoryIdValue: string, options: GatewayRequestOptions = {}): Promise<void> {
    const ref = parseRepositoryId(repositoryIdValue); const project = this.cloudflareProjects.get(repositoryIdValue);
    if (project) {
      await this.client.request(`${this.cloudflareBase()}/accounts/${encodeURIComponent(this.cloudflareAccount())}/pages/projects/${encodeURIComponent(project)}`, { method: 'DELETE', headers: { ...this.headers('cloudflare'), 'x-idempotency-key': operationKey(repositoryIdValue, 'delete-cloudflare') } }, options);
      this.cloudflareProjects.delete(repositoryIdValue);
    }
    const url = ref.provider === 'github' ? `${this.githubBase()}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}` : `${this.gitlabBase()}/projects/${encodeURIComponent(`${ref.owner}/${ref.name}`)}`;
    await this.client.request(url, { method: 'DELETE', headers: { ...this.headers(ref.provider), 'x-idempotency-key': operationKey(repositoryIdValue, 'delete-repository') } }, options);
  }

  private githubBase(): string { return (this.options.githubApiBaseUrl ?? 'https://api.github.com').replace(/\/$/, ''); }
  private gitlabBase(): string { return (this.options.gitlabApiBaseUrl ?? 'https://gitlab.com/api/v4').replace(/\/$/, ''); }
  private cloudflareBase(): string { return (this.options.cloudflareApiBaseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, ''); }
  private cloudflareAccount(): string { const account = this.options.cloudflareAccountId?.trim(); if (!account) throw new DomainError('unsupported', 'Cloudflare account id is not configured'); return account; }
  private gitlabNamespace(_owner: string): string | undefined { return process.env.TUOMO_GITLAB_NAMESPACE_ID?.trim() || undefined; }
  private headers(provider: ProvisionRequest['provider'] | 'cloudflare'): Record<string, string> {
    if (provider === 'github') return { accept: 'application/vnd.github+json', ...(this.options.githubToken ? { authorization: `Bearer ${this.options.githubToken}` } : {}) };
    if (provider === 'gitlab') return { ...(this.options.gitlabToken ? { 'private-token': this.options.gitlabToken } : {}) };
    return { authorization: `Bearer ${this.options.cloudflareToken ?? ''}` };
  }
}

function repositoryId(provider: ProvisionRequest['provider'], owner: string, name: string): string { return `${provider}:${owner}/${name}`; }
function operationKey(repositoryIdValue: string, operation: string): string { return `tuomo:${operation}:${repositoryIdValue}`.slice(0, 200); }
function parseRepositoryId(value: string): RepositoryRef {
  const match = /^(github|gitlab):([^/]+)\/([^/]+)$/.exec(value);
  if (!match) throw new DomainError('validation', 'Invalid provisioning repository id');
  return { provider: match[1] as ProvisionRequest['provider'], owner: match[2], name: match[3] };
}
function validateName(value: string, label: string): void { if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value)) throw new DomainError('validation', `Invalid ${label}`); }
function encodePath(path: string): string { return path.split('/').map(encodeURIComponent).join('/'); }
function normalizeUrl(value: string): string { return /^https?:\/\//i.test(value) ? value : `https://${value}`; }
async function delayWithCancellation(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DomainError('cancelled', 'Site build polling cancelled');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(new DomainError('cancelled', 'Site build polling cancelled')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
