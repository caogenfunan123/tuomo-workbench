import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import type { SyncTransport } from '../application/ports.ts';
import type { OutboxEntry } from '../application/sync-transports.ts';

export class JsonSyncOutboxStore {
  private readonly path: string;
  private readonly entries = new Map<string, OutboxEntry>();
  private loaded = false;
  constructor(path: string) { this.path = path; }

  async enqueue(entry: OutboxEntry): Promise<void> { this.assertId(entry.id); await this.load(); this.entries.set(entry.id, structuredClone(entry)); await this.flushFile(); }
  async list(now = Date.now()): Promise<OutboxEntry[]> { await this.load(); return [...this.entries.values()].filter((entry) => entry.nextAttemptAt <= now).map((entry) => structuredClone(entry)); }
  async remove(id: string): Promise<void> { this.assertId(id); await this.load(); this.entries.delete(id); await this.flushFile(); }
  async flush(transport: SyncTransport, now = Date.now(), options: { signal?: AbortSignal } = {}): Promise<{ succeeded: string[]; failed: string[]; cancelled: boolean }> {
    const succeeded: string[] = [];
    const failed: string[] = [];
    let cancelled = false;
    for (const entry of await this.list(now)) {
      if (options.signal?.aborted) { cancelled = true; break; }
      try { await transport.push(entry.objects, { signal: options.signal }); await this.remove(entry.id); succeeded.push(entry.id); }
      catch (error) { const next = { ...entry, attempts: entry.attempts + 1, nextAttemptAt: now + Math.min(60_000, 1_000 * 2 ** (entry.attempts + 1)), lastError: error instanceof Error ? error.message : String(error) }; await this.enqueue(next); failed.push(entry.id); }
    }
    return { succeeded, failed, cancelled };
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const values = JSON.parse(await fs.readFile(this.path, 'utf8')) as OutboxEntry[];
      for (const entry of values) { this.assertId(entry.id); this.entries.set(entry.id, entry); }
    } catch (error: any) { if (error.code !== 'ENOENT') throw new DomainError('storage', `Unable to read sync outbox: ${error.message}`); }
  }
  private async flushFile(): Promise<void> { const temporary = `${this.path}.${process.pid}.tmp`; await fs.mkdir(dirname(this.path), { recursive: true }); await fs.writeFile(temporary, JSON.stringify([...this.entries.values()], null, 2)); await fs.rename(temporary, this.path); }
  private assertId(id: string): void { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new DomainError('security', 'Sync outbox id is invalid'); }
}
