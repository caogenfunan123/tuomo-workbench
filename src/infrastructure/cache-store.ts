import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath } from '../domain/values.ts';

export type CacheEntry = { key: string; value: string; expiresAt?: number; updatedAt: string };

/** Small, atomic JSON cache used by remote article/tool adapters. It is disposable by design. */
export class JsonCacheStore {
  private readonly path: string;
  private entries = new Map<string, CacheEntry>();
  private loaded = false;

  constructor(path: string) { this.path = path; }

  async get(key: string, now = Date.now()): Promise<string | undefined> {
    await this.load();
    const entry = this.entries.get(normalizeKey(key));
    if (!entry || (entry.expiresAt !== undefined && entry.expiresAt <= now)) {
      if (entry) { this.entries.delete(entry.key); await this.flush(); }
      return undefined;
    }
    return entry.value;
  }

  async put(key: string, value: string, ttlMs?: number): Promise<void> {
    await this.load();
    const safeKey = normalizeKey(key);
    this.entries.set(safeKey, { key: safeKey, value, expiresAt: ttlMs === undefined ? undefined : Date.now() + Math.max(0, ttlMs), updatedAt: new Date().toISOString() });
    await this.flush();
  }

  async prune(now = Date.now()): Promise<number> {
    await this.load();
    const before = this.entries.size;
    for (const [key, entry] of this.entries) if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.entries.delete(key);
    if (this.entries.size !== before) await this.flush();
    return before - this.entries.size;
  }

  async clear(): Promise<number> {
    await this.load();
    const count = this.entries.size;
    this.entries.clear();
    await this.flush();
    return count;
  }

  async list(now = Date.now()): Promise<CacheEntry[]> {
    await this.prune(now);
    return [...this.entries.values()].map((entry) => structuredClone(entry));
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const values = JSON.parse(await fs.readFile(this.path, 'utf8')) as unknown;
      if (!Array.isArray(values)) throw new DomainError('storage', 'Cache file is invalid');
      for (const value of values) if (value && typeof value === 'object' && typeof (value as any).key === 'string' && typeof (value as any).value === 'string') this.entries.set(normalizeKey((value as any).key), value as CacheEntry);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  private async flush(): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify([...this.entries.values()], null, 2), { flag: 'w' });
    await fs.rename(temporary, this.path);
  }
}

function normalizeKey(value: string): string {
  return SafeRelativePath.parse(value.replaceAll('\\', '/')).value;
}
