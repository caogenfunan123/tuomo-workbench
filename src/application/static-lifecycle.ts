import { DomainError } from '../domain/errors.ts';
import type { RenderedFile } from '../domain/renderer.ts';
import type { StaticSite } from '../domain/site.ts';
import { SafeRelativePath } from '../domain/values.ts';
import type { AuditStore, GatewayRequestOptions, StaticPublishGateway } from './ports.ts';

export type RecoverableRemoteDelete = { site: StaticSite; siteId: string; path: string; file: RenderedFile; deletedRevision: string };
export type RemoteDeleteResult = { siteId: string; path: string; ok: boolean; error?: unknown };
export type RemoteDeleteBatchResult = { results: RemoteDeleteResult[]; cancelled: boolean };

export class StaticFileLifecycleUseCase {
  private readonly gateway: StaticPublishGateway;
  private readonly audit?: AuditStore;
  constructor(gateway: StaticPublishGateway, audit?: AuditStore) { this.gateway = gateway; this.audit = audit; }
  async delete(site: StaticSite, path: string, expectedRevision: string, options: GatewayRequestOptions = {}): Promise<void> { await this.gateway.deleteFile(site, path, expectedRevision, options); await this.audit?.append({ action: 'remote-file.delete', subject: path, details: { siteId: site.id, revision: expectedRevision } }); }
  async deleteRecoverable(site: StaticSite, path: string, expectedRevision: string, options: GatewayRequestOptions = {}): Promise<RecoverableRemoteDelete> {
    const current = await this.gateway.getFile(site, path, options);
    if (!current || current.revision !== expectedRevision) throw new DomainError('conflict', `Remote file changed before delete: ${path}`);
    await this.gateway.deleteFile(site, path, expectedRevision, options);
    const file: RenderedFile = { path: SafeRelativePath.parse(path), content: current.content, warnings: [], framework: 'remote-delete' };
    await this.audit?.append({ action: 'remote-file.delete.recoverable', subject: path, details: { siteId: site.id, revision: expectedRevision } });
    return { site, siteId: site.id, path, file, deletedRevision: expectedRevision };
  }
  async restoreDeleted(deleted: RecoverableRemoteDelete, options: GatewayRequestOptions = {}): Promise<{ revision: string }> {
    const result = await this.gateway.putFile(deleted.site, deleted.file, undefined, options);
    await this.audit?.append({ action: 'remote-file.restore', subject: deleted.path, details: { siteId: deleted.siteId, revision: result.revision } });
    return { revision: result.revision };
  }
  async deleteMany(items: Array<{ site: StaticSite; path: string; expectedRevision: string }>, concurrency = 4, signal?: AbortSignal): Promise<RemoteDeleteResult[]> {
    return (await this.deleteManyDetailed(items, concurrency, signal)).results;
  }
  async deleteManyDetailed(items: Array<{ site: StaticSite; path: string; expectedRevision: string }>, concurrency = 4, signal?: AbortSignal): Promise<RemoteDeleteBatchResult> {
    const results: Array<RemoteDeleteResult | undefined> = new Array(items.length); let cancelled = false;
    let next = 0;
    const consume = async (): Promise<void> => {
      while (true) {
        if (signal?.aborted) { cancelled = true; return; }
        const index = next++;
        if (index >= items.length) return;
        const item = items[index];
        try { await this.delete(item.site, item.path, item.expectedRevision, { signal }); results[index] = { siteId: item.site.id, path: item.path, ok: true }; }
        catch (error) { results[index] = { siteId: item.site.id, path: item.path, ok: false, error }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), 4, items.length || 1) }, consume));
    return { results: results.filter((result): result is RemoteDeleteResult => result !== undefined), cancelled };
  }
  async rollback(site: StaticSite, file: RenderedFile, expectedRevision: string, options: GatewayRequestOptions = {}): Promise<{ revision: string }> { const current = await this.gateway.getFile(site, file.path.value, options); if (!current || current.revision !== expectedRevision) throw new DomainError('conflict', 'Remote file changed before rollback'); const result = await this.gateway.putFile(site, file, expectedRevision, options); await this.audit?.append({ action: 'remote-file.rollback', subject: file.path.value, details: { siteId: site.id, revision: result.revision } }); return { revision: result.revision }; }
}
