import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import type { AgentSession, AgentSessionStore } from '../application/ai.ts';

type SessionFile = { schemaVersion: 1; sessions: AgentSession[] };

/** Atomic, site-scoped-capable persistence for resumable AI conversations. */
export class JsonAgentSessionStore implements AgentSessionStore {
  private readonly path: string;
  private readonly sessions = new Map<string, AgentSession>();
  private loaded = false;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(path: string) { this.path = path; }

  async load(id: string): Promise<AgentSession | undefined> {
    this.assertId(id);
    await this.ensureLoaded();
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : undefined;
  }

  async save(session: AgentSession): Promise<void> {
    this.assertId(session.id);
    if (session.siteId !== undefined) this.assertId(session.siteId);
    if (!Array.isArray(session.history) || typeof session.summary !== 'string' || !Number.isFinite(session.budget)) {
      throw new DomainError('validation', 'Invalid agent session');
    }
    await this.ensureLoaded();
    this.sessions.set(session.id, structuredClone(session));
    this.writeTail = this.writeTail.then(() => this.persist());
    await this.writeTail;
  }

  async list(siteId?: string): Promise<AgentSession[]> {
    if (siteId !== undefined) this.assertId(siteId);
    await this.ensureLoaded();
    return [...this.sessions.values()]
      .filter((session) => siteId === undefined || session.siteId === siteId)
      .map((session) => structuredClone(session));
  }

  async remove(id: string): Promise<void> {
    this.assertId(id);
    await this.ensureLoaded();
    this.sessions.delete(id);
    this.writeTail = this.writeTail.then(() => this.persist());
    await this.writeTail;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const value = JSON.parse(await fs.readFile(this.path, 'utf8')) as SessionFile;
      if (value.schemaVersion !== 1 || !Array.isArray(value.sessions)) throw new DomainError('storage', 'Unsupported agent session schema');
      for (const session of value.sessions) {
        this.assertId(session.id);
        if (session.siteId !== undefined) this.assertId(session.siteId);
        this.sessions.set(session.id, structuredClone(session));
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error instanceof DomainError ? error : new DomainError('storage', `Unable to read agent sessions: ${error?.message ?? String(error)}`);
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(dirname(this.path), { recursive: true });
    const value: SessionFile = { schemaVersion: 1, sessions: [...this.sessions.values()].map((session) => structuredClone(session)) };
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    await fs.rename(temporary, this.path);
  }

  private assertId(value: string): void {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new DomainError('security', 'Agent session id is invalid');
  }
}
