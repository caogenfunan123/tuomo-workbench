import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath, newId } from '../domain/values.ts';
import type { SiteId } from '../domain/values.ts';
import type { AgentFileChange, AgentTask, AgentWorklog } from '../application/agent-workspace.ts';

type TaskFile = { schemaVersion: 1; tasks: AgentTask[] };

/** Persistent task/timeline store for resumable, site-scoped agent work. */
export class JsonAgentWorkspaceStore {
  private readonly path: string;
  private readonly tasks = new Map<string, AgentTask>();
  private loaded = false;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(path: string) { this.path = path; }

  async create(goal: string, siteId?: SiteId, workspace?: string): Promise<AgentTask> {
    if (!goal.trim()) throw new DomainError('validation', 'Agent goal cannot be empty');
    if (siteId !== undefined) this.assertId(siteId);
    await this.ensureLoaded();
    const task: AgentTask = { id: newId(), siteId, goal: goal.trim(), workspace, attachments: [], changes: [], timeline: [], state: 'queued', budget: 32 };
    this.tasks.set(task.id, task);
    await this.persistQueued();
    return structuredClone(task);
  }

  async get(id: string): Promise<AgentTask | undefined> { this.assertId(id); await this.ensureLoaded(); const task = this.tasks.get(id); return task ? structuredClone(task) : undefined; }

  async append(taskId: string, entry: AgentWorklog): Promise<void> { const task = await this.require(taskId); task.timeline.push(structuredClone(entry)); this.tasks.set(task.id, task); await this.persistQueued(); }

  async addChange(taskId: string, change: AgentFileChange): Promise<void> { const task = await this.require(taskId); const normalized = { ...change, path: SafeRelativePath.parse(change.path).value }; task.changes.push(structuredClone(normalized)); this.tasks.set(task.id, task); await this.persistQueued(); }

  async setState(taskId: string, state: AgentTask['state']): Promise<void> { const task = await this.require(taskId); task.state = state; this.tasks.set(task.id, task); await this.persistQueued(); }

  async list(siteId?: SiteId): Promise<AgentTask[]> { if (siteId !== undefined) this.assertId(siteId); await this.ensureLoaded(); return [...this.tasks.values()].filter((task) => siteId === undefined || task.siteId === siteId).map((task) => structuredClone(task)); }

  private async require(id: string): Promise<AgentTask> { this.assertId(id); await this.ensureLoaded(); const task = this.tasks.get(id); if (!task) throw new DomainError('notFound', 'Agent task not found'); return structuredClone(task); }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const value = JSON.parse(await fs.readFile(this.path, 'utf8')) as TaskFile;
      if (value.schemaVersion !== 1 || !Array.isArray(value.tasks)) throw new DomainError('storage', 'Unsupported agent task schema');
      for (const task of value.tasks) { this.assertId(task.id); if (task.siteId !== undefined) this.assertId(task.siteId); const normalized = { ...task, changes: task.changes.map((change) => ({ ...change, path: SafeRelativePath.parse(change.path).value })) }; this.tasks.set(task.id, structuredClone(normalized)); }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error instanceof DomainError ? error : new DomainError('storage', `Unable to read agent tasks: ${error?.message ?? String(error)}`);
      await this.persist();
    }
  }

  private async persistQueued(): Promise<void> { this.writeTail = this.writeTail.then(() => this.persist()); await this.writeTail; }
  private async persist(): Promise<void> { const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`; await fs.mkdir(dirname(this.path), { recursive: true }); await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, tasks: [...this.tasks.values()] }, null, 2), { flag: 'wx' }); await fs.rename(temporary, this.path); }
  private assertId(value: string): void { if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new DomainError('security', 'Agent task id is invalid'); }
}
