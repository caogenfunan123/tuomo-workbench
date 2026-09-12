import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { CmsPostGateway, GatewayRequestOptions, StaticPublishGateway } from '../application/ports.ts';
import type { ImageHostGateway } from '../application/content-tools.ts';
import type { CmsSite, StaticSite } from '../domain/site.ts';
import { DomainError } from '../domain/errors.ts';
import type { SecretRef } from '../domain/values.ts';
import { SafeRelativePath } from '../domain/values.ts';
import { HttpRemoteArticleQuery } from '../application/remote-articles.ts';
import type { CredentialResolver as RemoteCredentialResolver } from '../application/remote-articles.ts';
import { GhostCmsGateway, TypechoFastApiCmsGateway, TypechoRestfulCmsGateway, TypechoSecureCmsGateway, WordPressCmsGateway } from './cms-gateways.ts';
import type { CmsCredentialResolver } from './cms-gateways.ts';
import { HttpGitGateway } from './git-gateway.ts';
import { GitHubImageHostGateway } from './github-image-host.ts';
import type { CredentialResolver } from './git-gateway.ts';
import type { FetchLike } from './http-client.ts';
import { HttpProvisioningGateway } from './provisioning-gateway.ts';
import type { ProvisioningGatewayOptions } from './provisioning-gateway.ts';
import { ProviderBatchUploadGateway } from './batch-upload-gateway.ts';
import type { BatchUploadUseCase } from '../application/content-tools.ts';

const execFileAsync = promisify(execFile);

/**
 * Runtime credential bridge for the reference host.
 *
 * Site files contain only a SecretRef. The corresponding value is supplied by
 * TUOMO_SECRET_<REF_ID> at process start and is never serialized by this
 * module. A deployment can replace these resolvers with a real vault without
 * changing any publish use case.
 */
export function environmentSecret(ref?: SecretRef): string | undefined {
  if (!ref) return undefined;
  return process.env[environmentSecretName(ref)];
}

export function environmentSecretName(ref: SecretRef): string {
  return `TUOMO_SECRET_${ref.id.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()}`;
}

export function createEnvironmentStaticCredentialResolver(): CredentialResolver {
  return async (site: StaticSite) => environmentSecret(site.config.credentialRef);
}

export function createEnvironmentRemoteCredentialResolver(): RemoteCredentialResolver {
  return async (site: StaticSite) => {
    const value = environmentSecret(site.config.credentialRef);
    return value ? { authorization: `Bearer ${value}` } : {};
  };
}

export function createEnvironmentCmsCredentialResolver(): CmsCredentialResolver {
  return async (site: CmsSite) => {
    const value = environmentSecret(site.config.authRef);
    if (!value) return {};
    const options = site.config.adapterOptions;
    const headerName = String(options.authHeaderName ?? 'authorization');
    const scheme = String(options.authScheme ?? 'Bearer').trim();
    const headerValue = scheme && !/^\S+\s+/.test(value) ? `${scheme} ${value}` : value;
    return { [headerName]: headerValue };
  };
}

/** Routes one CMS port to the protocol-specific adapter selected by the Site. */
export class RoutedCmsGateway implements CmsPostGateway {
  private readonly wordpress: CmsPostGateway;
  private readonly ghost: CmsPostGateway;
  private readonly typechoSecure: CmsPostGateway;
  private readonly typechoFastApi: CmsPostGateway;
  private readonly typechoRestful: CmsPostGateway;

  constructor(wordpress: CmsPostGateway, ghost: CmsPostGateway, typechoSecure: CmsPostGateway, typechoFastApi: CmsPostGateway, typechoRestful: CmsPostGateway) {
    this.wordpress = wordpress;
    this.ghost = ghost;
    this.typechoSecure = typechoSecure;
    this.typechoFastApi = typechoFastApi;
    this.typechoRestful = typechoRestful;
  }

  list(site: CmsSite, query: Parameters<CmsPostGateway['list']>[1], options?: GatewayRequestOptions) {
    return this.adapter(site).list(site, query, options);
  }

  create(site: CmsSite, post: Parameters<CmsPostGateway['create']>[1], options?: GatewayRequestOptions) {
    return this.adapter(site).create(site, post, options);
  }

  update(site: CmsSite, id: string, post: Parameters<CmsPostGateway['update']>[2], expectedRevision?: string, options?: GatewayRequestOptions) {
    return this.adapter(site).update(site, id, post, expectedRevision, options);
  }

  delete(site: CmsSite, id: string, options?: GatewayRequestOptions) {
    return this.adapter(site).delete(site, id, options);
  }

  private adapter(site: CmsSite): CmsPostGateway {
    switch (site.config.cmsKind) {
      case 'wordpress': return this.wordpress;
      case 'ghost': return this.ghost;
      case 'typecho-secure': return this.typechoSecure;
      case 'typecho-fastapi': return this.typechoFastApi;
      case 'typecho-restful': return this.typechoRestful;
    }
  }
}

export function createEnvironmentCmsGateway(fetcher?: FetchLike): RoutedCmsGateway {
  const credential = createEnvironmentCmsCredentialResolver();
  return new RoutedCmsGateway(
    new WordPressCmsGateway(credential, fetcher),
    new GhostCmsGateway(credential, fetcher),
    new TypechoSecureCmsGateway(credential, fetcher),
    new TypechoFastApiCmsGateway(credential, fetcher),
    new TypechoRestfulCmsGateway(credential, fetcher),
  );
}

export function createEnvironmentStaticGateway(fetcher?: FetchLike): StaticPublishGateway {
  return new HttpGitGateway(createEnvironmentStaticCredentialResolver(), fetcher);
}

export function createEnvironmentRemoteArticleQuery(fetcher?: FetchLike): HttpRemoteArticleQuery {
  return new HttpRemoteArticleQuery(createEnvironmentRemoteCredentialResolver(), fetcher);
}

export function createEnvironmentImageHost(site: StaticSite, fetcher?: FetchLike): ImageHostGateway {
  if (site.config.provider !== 'github') throw new DomainError('unsupported', 'GitHub image host requires a GitHub static site');
  const credential = createEnvironmentStaticCredentialResolver();
  return new GitHubImageHostGateway({
    repository: site.config.repository,
    branch: site.config.branch,
    apiBaseUrl: site.config.apiBaseUrl,
    credentials: async () => credential(site),
  }, fetcher);
}

export function createEnvironmentProvisioningGateway(fetcher?: FetchLike): HttpProvisioningGateway {
  const options: ProvisioningGatewayOptions = {
    githubToken: process.env.TUOMO_SECRET_GITHUB,
    gitlabToken: process.env.TUOMO_SECRET_GITLAB,
    cloudflareToken: process.env.TUOMO_SECRET_CLOUDFLARE,
    cloudflareAccountId: process.env.TUOMO_CLOUDFLARE_ACCOUNT_ID,
    githubOwnerType: process.env.TUOMO_GITHUB_OWNER_TYPE === 'org' ? 'org' : 'user',
  };
  return new HttpProvisioningGateway(options, fetcher);
}

export function createEnvironmentBatchUpload(site: StaticSite, fetcher?: FetchLike): BatchUploadUseCase {
  if (site.config.provider !== 'github' && site.config.provider !== 'gitlab') throw new DomainError('unsupported', 'Batch upload requires a GitHub or GitLab static site');
  const cliRoot = process.env.TUOMO_GIT_CLI_ROOT?.trim();
  const gateway = new ProviderBatchUploadGateway({ provider: site.config.provider, repository: site.config.repository, branch: site.config.branch, apiBaseUrl: site.config.apiBaseUrl, token: environmentSecret(site.config.credentialRef), cliUpload: cliRoot ? createGitCliUploader(resolve(cliRoot), site.config.branch) : undefined }, fetcher);
  return gateway.asUseCase();
}

function createGitCliUploader(root: string, branch: string): (path: string, data: Uint8Array) => Promise<void> {
  return async (path, data) => {
    const safe = SafeRelativePath.parse(path).value; const target = resolve(root, safe); const escaped = relative(root, target);
    if (escaped === '..' || escaped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(escaped)) throw new DomainError('security', 'CLI upload path escapes configured repository');
    await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, data);
    await execFileAsync('git', ['-C', root, 'add', '--', safe]);
    await execFileAsync('git', ['-C', root, 'commit', '-m', 'Tuomo batch upload', '--', safe]);
    await execFileAsync('git', ['-C', root, 'push', 'origin', branch]);
  };
}
