import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { createCmsSite, createStaticSite } from '../domain/site.ts';
import type { CmsSite, Site, StaticSite } from '../domain/site.ts';
import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath, siteId } from '../domain/values.ts';
import type { SiteRegistry } from '../application/ports.ts';

type StoredSite = Omit<StaticSite, 'id' | 'config'> & { id: string; config: Record<string, unknown> } | Omit<CmsSite, 'id' | 'config'> & { id: string; config: Record<string, unknown> };
type RegistryFile = { schemaVersion: 1; activeSiteId?: string; sites: StoredSite[] };

/** Persistent site registry. Only site configuration and SecretRef metadata are stored. */
export class JsonSiteRegistry implements SiteRegistry {
  private readonly path: string;
  private readonly sites = new Map<string, Site>();
  private activeSiteId?: string;
  private loaded = false;

  constructor(path: string) { this.path = path; }

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const value = JSON.parse(await fs.readFile(this.path, 'utf8')) as RegistryFile;
      if (value.schemaVersion !== 1 || !Array.isArray(value.sites)) throw new DomainError('storage', 'Unsupported site registry schema');
      for (const stored of value.sites) {
        const site = deserializeSite(stored);
        this.sites.set(site.id, site);
      }
      this.activeSiteId = value.activeSiteId && this.sites.has(value.activeSiteId) ? value.activeSiteId : undefined;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error instanceof DomainError ? error : new DomainError('storage', `Unable to read site registry: ${error?.message ?? String(error)}`);
      await this.persist();
    }
  }

  get(id: string): Site | undefined { const site = this.sites.get(id); return site ? structuredClone(site) : undefined; }
  list(): Site[] { return [...this.sites.values()].map((site) => structuredClone(site)); }
  active(): Site | undefined { return this.activeSiteId ? this.get(this.activeSiteId) : this.list().find((site) => site.isDefault); }

  async add(site: Site): Promise<void> {
    await this.init();
    if (this.sites.has(site.id)) throw new DomainError('conflict', `Site already exists: ${site.id}`);
    if (site.isDefault) this.clearDefault();
    this.sites.set(site.id, structuredClone(site));
    if (!this.activeSiteId || site.isDefault) this.activeSiteId = site.id;
    await this.persist();
  }

  async update(site: Site): Promise<void> {
    await this.init();
    if (!this.sites.has(site.id)) throw new DomainError('notFound', `Site not found: ${site.id}`);
    if (site.isDefault) this.clearDefault();
    this.sites.set(site.id, structuredClone(site));
    if (!this.activeSiteId) this.activeSiteId = site.id;
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    await this.init();
    if (!this.sites.delete(id)) throw new DomainError('notFound', `Site not found: ${id}`);
    if (this.activeSiteId === id) this.activeSiteId = this.list().find((site) => site.isDefault)?.id;
    await this.persist();
  }

  async switchTo(id: string): Promise<Site> {
    await this.init();
    if (!this.sites.has(id)) throw new DomainError('notFound', `Site not found: ${id}`);
    this.activeSiteId = id;
    await this.persist();
    return this.get(id)!;
  }

  private clearDefault(): void { for (const site of this.sites.values()) site.isDefault = false; }

  private async persist(): Promise<void> {
    const value: RegistryFile = { schemaVersion: 1, activeSiteId: this.activeSiteId, sites: this.list().map(serializeSite) };
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    await fs.rename(temporary, this.path);
  }
}

function serializeSite(site: Site): StoredSite {
  if (site.kind === 'static') {
    return { ...site, config: { ...site.config, postPath: site.config.postPath.value, pagePath: site.config.pagePath.value } };
  }
  return { ...site, config: { ...site.config } };
}

function deserializeSite(stored: StoredSite): Site {
  if (stored.kind === 'static') {
    const config = stored.config;
    return createStaticSite({ ...stored, config: {
      ...config,
      provider: config.provider as StaticSite['config']['provider'],
      repository: String(config.repository ?? ''),
      branch: String(config.branch ?? ''),
      postPath: SafeRelativePath.parse(String(config.postPath ?? 'posts')),
      pagePath: SafeRelativePath.parse(String(config.pagePath ?? 'pages')),
      framework: config.framework as StaticSite['config']['framework'],
      publishTimeZoneOffsetMinutes: Number(config.publishTimeZoneOffsetMinutes ?? 480),
      mirrors: Array.isArray(config.mirrors) ? config.mirrors.map(String) : [],
      hooks: Array.isArray(config.hooks) ? config.hooks.map(String) : [],
    } });
  }
  return createCmsSite({ ...stored, config: {
    ...stored.config,
    cmsKind: stored.config.cmsKind as CmsSite['config']['cmsKind'],
    baseUrl: String(stored.config.baseUrl ?? ''),
    ignoreSsl: stored.config.ignoreSsl === true,
    adapterOptions: (stored.config.adapterOptions as Record<string, unknown> | undefined) ?? {},
  } });
}
