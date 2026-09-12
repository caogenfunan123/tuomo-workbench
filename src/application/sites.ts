import { DomainError } from '../domain/errors.ts';
import { validateSite } from '../domain/site.ts';
import type { CmsSite, Site } from '../domain/site.ts';
import type { AuditStore, CmsPostGateway, GatewayRequestOptions, SiteRegistry } from './ports.ts';

export type SiteHealth = { siteId: string; reachable: boolean; status: 'healthy' | 'degraded' | 'offline'; httpStatus?: number; pageNonEmpty?: boolean; lastCommitAt?: string; checkedAt: string; error?: string };
export type SiteCheck = (site: Site, options?: GatewayRequestOptions) => Promise<Pick<SiteHealth, 'reachable' | 'httpStatus' | 'pageNonEmpty' | 'lastCommitAt'>>;

export class InMemorySiteRegistry implements SiteRegistry {
  private readonly sites = new Map<string, Site>();
  private activeSiteId?: string;
  constructor(initial: Site[] = []) { for (const site of initial) this.add(site); }
  get(id: string): Site | undefined { return this.sites.get(id); }
  list(): Site[] { return [...this.sites.values()].map((site) => structuredClone(site)); }
  active(): Site | undefined { return this.activeSiteId ? this.get(this.activeSiteId) : this.list().find((site) => site.isDefault); }
  add(site: Site): void { validateSite(site); if (this.sites.has(site.id)) throw new DomainError('conflict', `Site already exists: ${site.id}`); if (site.isDefault) for (const current of this.sites.values()) current.isDefault = false; this.sites.set(site.id, structuredClone(site)); if (!this.activeSiteId || site.isDefault) this.activeSiteId = site.id; }
  update(site: Site): void { validateSite(site); if (!this.sites.has(site.id)) throw new DomainError('notFound', `Site not found: ${site.id}`); if (site.isDefault) for (const current of this.sites.values()) current.isDefault = false; this.sites.set(site.id, structuredClone(site)); }
  remove(id: string): void { if (!this.sites.delete(id)) throw new DomainError('notFound', `Site not found: ${id}`); if (this.activeSiteId === id) this.activeSiteId = this.list().find((site) => site.isDefault)?.id ?? this.list()[0]?.id; }
  switchTo(id: string): Site { if (!this.sites.has(id)) throw new DomainError('notFound', `Site not found: ${id}`); this.activeSiteId = id; return this.get(id)!; }
}

export class SiteHealthMonitor {
  private readonly registry: SiteRegistry;
  private readonly check: SiteCheck;
  private readonly audit?: AuditStore;
  constructor(registry: SiteRegistry, check: SiteCheck, audit?: AuditStore) { this.registry = registry; this.check = check; this.audit = audit; }
  async checkOne(siteId: string, options: GatewayRequestOptions = {}): Promise<SiteHealth> {
    const site = this.registry.get(siteId); if (!site) throw new DomainError('notFound', `Site not found: ${siteId}`);
    const checkedAt = new Date().toISOString();
    try { const result = await this.check(site, options); const status = result.reachable && result.pageNonEmpty !== false ? 'healthy' : result.reachable ? 'degraded' : 'offline'; const health = { siteId, ...result, status, checkedAt } as SiteHealth; await this.audit?.append({ action: 'site.health', subject: siteId, details: health }); return health; }
    catch (error) { const health: SiteHealth = { siteId, reachable: false, status: 'offline', checkedAt, error: error instanceof Error ? error.message : String(error) }; await this.audit?.append({ action: 'site.health.failed', subject: siteId, details: health }); return health; }
  }
  async checkAll(concurrency = 4, options: GatewayRequestOptions = {}): Promise<SiteHealth[]> { const sites = this.registry.list(); const output: SiteHealth[] = []; let index = 0; const worker = async () => { while (true) { if (options.signal?.aborted) return; const current = index++; if (current >= sites.length) return; output[current] = await this.checkOne(sites[current].id, options); } }; await Promise.all(Array.from({ length: Math.min(4, Math.max(1, concurrency), Math.max(1, sites.length)) }, worker)); return output.filter((value): value is SiteHealth => value !== undefined); }
}

export type CmsConnectivityResult = { siteId: string; reachable: boolean; checkedAt: string; postCount?: number; error?: string };

export class CmsConnectivityUseCase {
  private readonly registry: SiteRegistry;
  private readonly gateway: CmsPostGateway;
  private readonly audit?: AuditStore;
  constructor(registry: SiteRegistry, gateway: CmsPostGateway, audit?: AuditStore) { this.registry = registry; this.gateway = gateway; this.audit = audit; }

  async check(siteId: string, options: GatewayRequestOptions = {}): Promise<CmsConnectivityResult> {
    const site = this.registry.get(siteId);
    if (!site) throw new DomainError('notFound', `Site not found: ${siteId}`);
    if (site.kind !== 'cms') throw new DomainError('validation', `Site is not a CMS site: ${siteId}`);
    const checkedAt = new Date().toISOString();
    try {
      const posts = await this.gateway.list(site as CmsSite, { limit: 1 }, options);
      const result: CmsConnectivityResult = { siteId, reachable: true, checkedAt, postCount: posts.length };
      await this.audit?.append({ action: 'site.cms.connectivity', subject: siteId, details: result });
      return result;
    } catch (error) {
      const result: CmsConnectivityResult = { siteId, reachable: false, checkedAt, error: error instanceof Error ? error.message : String(error) };
      await this.audit?.append({ action: 'site.cms.connectivity.failed', subject: siteId, details: result });
      return result;
    }
  }
}
