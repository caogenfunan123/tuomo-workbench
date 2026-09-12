import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { BindingStore } from '../application/ports.ts';
import type { RemoteBinding } from '../domain/site.ts';
import { articleId, siteId } from '../domain/values.ts';
import { DomainError } from '../domain/errors.ts';

/** Persistent local-to-remote bindings; it never stores provider credentials. */
export class JsonBindingStore implements BindingStore {
  private readonly path: string;
  private readonly values = new Map<string, RemoteBinding>();
  private loaded = false;

  constructor(path: string) { this.path = path; }

  async get(site: string, article: string): Promise<RemoteBinding | undefined> {
    await this.load();
    const value = this.values.get(key(site, article));
    return value ? structuredClone(value) : undefined;
  }

  async put(binding: RemoteBinding): Promise<void> {
    await this.load();
    const normalized: RemoteBinding = { ...binding, siteId: siteId(binding.siteId), articleId: articleId(binding.articleId) };
    this.values.set(key(normalized.siteId, normalized.articleId), structuredClone(normalized));
    await this.persist();
  }

  async list(site?: string): Promise<RemoteBinding[]> {
    await this.load();
    if (!site) return [...this.values.values()].map((value) => structuredClone(value));
    const normalized = siteId(site);
    return [...this.values.values()].filter((value) => value.siteId === normalized).map((value) => structuredClone(value));
  }

  async remove(site: string, article: string): Promise<void> {
    await this.load();
    this.values.delete(key(site, article));
    await this.persist();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const values = JSON.parse(await fs.readFile(this.path, 'utf8')) as RemoteBinding[];
      if (!Array.isArray(values)) throw new DomainError('storage', 'Binding store must contain an array');
      for (const value of values) {
        const normalized: RemoteBinding = { ...value, siteId: siteId(value.siteId), articleId: articleId(value.articleId) };
        this.values.set(key(normalized.siteId, normalized.articleId), normalized);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error instanceof DomainError ? error : new DomainError('storage', `Unable to read binding store: ${error?.message ?? String(error)}`);
    }
  }

  private async persist(): Promise<void> {
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify([...this.values.values()], null, 2), { flag: 'wx' });
    await fs.rename(temporary, this.path);
  }
}

function key(site: string, article: string): string { return `${siteId(site)}:${articleId(article)}`; }
