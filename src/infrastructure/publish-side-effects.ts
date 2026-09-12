import { DomainError } from '../domain/errors.ts';
import type { RenderedFile } from '../domain/renderer.ts';
import type { StaticSite } from '../domain/site.ts';
import { sha256 } from '../domain/values.ts';
import type { GatewayRequestOptions, PublishSideEffectGateway } from '../application/ports.ts';
import type { FetchLike } from './http-client.ts';
import { HttpJsonClient } from './http-client.ts';

/** HTTP implementation for configured mirror endpoints and deployment hooks. */
export class HttpPublishSideEffects implements PublishSideEffectGateway {
  private readonly client: HttpJsonClient;
  private readonly allowInsecure: boolean;

  constructor(fetcher?: FetchLike, allowInsecure = process.env.TUOMO_ALLOW_INSECURE_HOOKS === '1') {
    this.client = new HttpJsonClient(fetcher);
    this.allowInsecure = allowInsecure;
  }

  async pushMirror(site: StaticSite, mirror: string, file: RenderedFile, options: GatewayRequestOptions = {}): Promise<void> {
    await this.post(mirror, {
      kind: 'mirror',
      siteId: site.id,
      repository: site.config.repository,
      branch: site.config.branch,
      path: file.path.value,
      content: file.content,
      framework: file.framework,
    }, options);
  }

  async triggerHook(site: StaticSite, hook: string, options: GatewayRequestOptions = {}): Promise<void> {
    await this.post(hook, {
      kind: 'deploy',
      siteId: site.id,
      repository: site.config.repository,
      branch: site.config.branch,
    }, options);
  }

  private async post(target: string, payload: Record<string, unknown>, options: GatewayRequestOptions): Promise<void> {
    const url = this.safeUrl(target);
    await this.client.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': sha256(JSON.stringify(payload)),
      },
      body: JSON.stringify(payload),
    }, options);
  }

  private safeUrl(target: string): string {
    let url: URL;
    try { url = new URL(target); } catch { throw new DomainError('validation', `Side-effect target must be an absolute URL: ${target}`); }
    if (!['https:', ...(this.allowInsecure ? ['http:'] : [])].includes(url.protocol)) {
      throw new DomainError('security', `Side-effect target must use HTTPS: ${target}`);
    }
    return url.toString();
  }
}
