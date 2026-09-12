import { DomainError } from '../domain/errors.ts';
import { createStaticSite } from '../domain/site.ts';
import type { StaticFramework } from '../domain/site.ts';
import { makeSecretRef, SafeRelativePath } from '../domain/values.ts';
import { SiteWizardUseCase } from './site-wizard.ts';
import type { AuditStore, GatewayRequestOptions, MutableSiteRegistry } from './ports.ts';

export type ProvisionMode = 'pages' | 'cloudflare';
export type ProvisionRequest = { provider: 'github' | 'gitlab'; owner: string; repository: string; framework: string; mode: ProvisionMode; welcomePost: string; idempotencyKey: string };
export type ProvisioningPort = { createRepository(request: ProvisionRequest, options?: GatewayRequestOptions): Promise<{ id: string; url: string }>; writeFile(repositoryId: string, path: string, content: string, idempotencyKey: string, options?: GatewayRequestOptions): Promise<void>; enablePages(repositoryId: string, options?: GatewayRequestOptions): Promise<void>; attachCloudflare(repositoryId: string, options?: GatewayRequestOptions): Promise<{ projectId: string; hook?: string }>; triggerCloudflareHook?(hook: string, options?: GatewayRequestOptions): Promise<void>; triggerBuild(repositoryId: string, options?: GatewayRequestOptions): Promise<void>; waitForBuild(repositoryId: string, timeoutMs: number, options?: GatewayRequestOptions): Promise<{ ok: boolean; url?: string }>; deleteRepository(repositoryId: string, options?: GatewayRequestOptions): Promise<void> };
export type ProvisionResult = { ok: boolean; repositoryId?: string; siteId?: string; url?: string; leftBehind: string[]; error?: unknown };

export class SiteProvisioningUseCase {
  private readonly wizard: SiteWizardUseCase;
  private readonly gateway: ProvisioningPort;
  private readonly registry?: MutableSiteRegistry;
  constructor(gateway: ProvisioningPort, audit?: AuditStore, registry?: MutableSiteRegistry) { this.gateway = gateway; this.wizard = new SiteWizardUseCase(audit); this.registry = registry; }
  async execute(request: ProvisionRequest, signal?: AbortSignal): Promise<ProvisionResult> {
    let repositoryId = ''; let url: string | undefined; let cloudflareHook: string | undefined;
    const options: GatewayRequestOptions = { signal };
    const files = skeletonFiles(request);
    const result = await this.wizard.execute([
      { id: 'create-repository', run: async () => { const created = await this.gateway.createRepository(request, options); repositoryId = created.id; url = created.url; return { kind: 'repository', id: created.id, rollback: () => this.gateway.deleteRepository(created.id, options) }; } },
      { id: 'write-skeleton', run: async () => { if (!repositoryId) throw new DomainError('storage', 'Repository was not created'); for (const [path, content] of Object.entries(files)) await this.gateway.writeFile(repositoryId, path, content, `${request.idempotencyKey}:skeleton:${path}`, options); return undefined; } },
      { id: request.mode === 'pages' ? 'enable-pages' : 'attach-cloudflare', run: async () => { if (request.mode === 'pages') await this.gateway.enablePages(repositoryId, options); else cloudflareHook = (await this.gateway.attachCloudflare(repositoryId, options)).hook; return undefined; } },
      { id: 'write-welcome-post', run: async () => { await this.gateway.writeFile(repositoryId, 'posts/welcome.md', request.welcomePost, request.idempotencyKey, options); return undefined; } },
      { id: 'trigger-build', run: async () => { if (cloudflareHook && this.gateway.triggerCloudflareHook) await this.gateway.triggerCloudflareHook(cloudflareHook, options); await this.gateway.triggerBuild(repositoryId, options); const build = await this.gateway.waitForBuild(repositoryId, 10 * 60_000, options); if (!build.ok) throw new DomainError('network', 'Site build failed or timed out'); url = build.url ?? url; return undefined; } },
    ], { signal });
    if (!result.ok) return { ok: false, repositoryId, url, leftBehind: result.leftBehind.map((resource) => resource.id), error: result.error };
    const siteId = await this.registerSite(request, url);
    return { ok: true, repositoryId, siteId, url, leftBehind: [] };
  }

  private async registerSite(request: ProvisionRequest, url?: string): Promise<string | undefined> {
    if (!this.registry) return undefined;
    const id = `provision-${request.provider}-${request.owner}-${request.repository}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
    if (!this.registry.get(id)) {
      const site = createStaticSite({ id, name: `${request.owner}/${request.repository}`, kind: 'static', isDefault: this.registry.list().length === 0, url, config: { provider: request.provider, repository: `${request.owner}/${request.repository}`, branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: request.framework as StaticFramework, publishTimeZoneOffsetMinutes: 480, credentialRef: makeSecretRef('credential', `${request.provider} provisioning credential`, request.provider), mirrors: [], hooks: [] } });
      await this.registry.add(site);
    }
    return id;
  }
}

function skeletonFiles(request: ProvisionRequest): Record<string, string> {
  const framework = request.framework.toLowerCase();
  const config = JSON.stringify({ framework, generatedBy: 'tuomo', version: 1 }, null, 2);
  const workflow = request.mode === 'pages' ? `name: Tuomo Pages\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "Build ${framework}"\n` : `name: Tuomo Cloudflare\non:\n  push:\n    branches: [main]\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "Deploy ${framework} through Cloudflare Pages"\n`;
  return { 'README.md': `# ${request.repository}\n\nGenerated by Tuomo.\n`, '.tuomo/framework.json': config, '.github/workflows/tuomo-pages.yml': workflow };
}
