import type { StaticSite } from '../domain/site.ts';
import { SafeRelativePath } from '../domain/values.ts';
import type { GatewayRequestOptions, SyncTransport } from '../application/ports.ts';
import type { StaticPublishGateway } from '../application/ports.ts';

export type GitSyncObject = { payload: string; revision: number; hash: string; modifiedAt: string };
export class GitSyncTransport implements SyncTransport {
  private readonly gateway: StaticPublishGateway;
  private readonly site: StaticSite;
  private readonly prefix: string;
  constructor(gateway: StaticPublishGateway, site: StaticSite, prefix = '.tuomo-sync') { this.gateway = gateway; this.site = site; this.prefix = SafeRelativePath.parse(prefix).value; }
  async pull(options: GatewayRequestOptions = {}): Promise<{ objects: Record<string, GitSyncObject> }> { const manifestFile = await this.gateway.getFile(this.site, `${this.prefix}/manifest.json`, options); if (!manifestFile) return { objects: {} }; const manifest = JSON.parse(manifestFile.content) as { keys?: string[] }; const objects: Record<string, GitSyncObject> = {}; for (const key of manifest.keys ?? []) { const file = await this.gateway.getFile(this.site, `${this.prefix}/objects/${encodeURIComponent(key)}.json`, options); if (file) objects[key] = JSON.parse(file.content) as GitSyncObject; } return { objects }; }
  async push(objects: Record<string, GitSyncObject>, options: GatewayRequestOptions = {}): Promise<void> {
    const existing = await this.pull(options);
    const keys = [...new Set([...Object.keys(existing.objects), ...Object.keys(objects)])];
    for (const key of Object.keys(objects)) await this.put(`${this.prefix}/objects/${encodeURIComponent(key)}.json`, JSON.stringify(objects[key]), options);
    await this.put(`${this.prefix}/manifest.json`, JSON.stringify({ keys, updatedAt: new Date().toISOString() }), options);
  }
  private async put(path: string, content: string, options: GatewayRequestOptions): Promise<void> { const current = await this.gateway.getFile(this.site, path, options); const file = { path: SafeRelativePath.parse(path), content, warnings: [], framework: 'sync' }; await this.gateway.putFile(this.site, file, current?.revision, options); }
}
