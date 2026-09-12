import { DomainError } from '../domain/errors.ts';
import type { SiteId } from '../domain/values.ts';
import { newId } from '../domain/values.ts';

export type AgentFileChange = { path: string; operation: 'create' | 'update' | 'delete'; beforeHash?: string; afterHash?: string; at: string };
export type AgentWorklog = { at: string; type: 'message' | 'tool' | 'file' | 'status'; text: string; toolId?: string };
export type AgentTask = { id: string; siteId?: SiteId; goal: string; workspace?: string; attachments: string[]; changes: AgentFileChange[]; timeline: AgentWorklog[]; state: 'queued' | 'running' | 'paused' | 'done' | 'failed'; budget: number };

export class AgentWorkspaceStore {
  private readonly tasks = new Map<string, AgentTask>();
  create(goal: string, siteId?: SiteId, workspace?: string): AgentTask { if (!goal.trim()) throw new DomainError('validation', 'Agent goal cannot be empty'); const task: AgentTask = { id: newId(), siteId, goal, workspace, attachments: [], changes: [], timeline: [], state: 'queued', budget: 32 }; this.tasks.set(task.id, task); return structuredClone(task); }
  get(id: string): AgentTask | undefined { const task = this.tasks.get(id); return task ? structuredClone(task) : undefined; }
  append(taskId: string, entry: AgentWorklog): void { const task = this.tasks.get(taskId); if (!task) throw new DomainError('notFound', 'Agent task not found'); task.timeline.push(entry); }
  addChange(taskId: string, change: AgentFileChange): void { const task = this.tasks.get(taskId); if (!task) throw new DomainError('notFound', 'Agent task not found'); task.changes.push(change); }
  setState(taskId: string, state: AgentTask['state']): void { const task = this.tasks.get(taskId); if (!task) throw new DomainError('notFound', 'Agent task not found'); task.state = state; }
  list(siteId?: SiteId): AgentTask[] { return [...this.tasks.values()].filter((task) => task.siteId === siteId).map((task) => structuredClone(task)); }
}

export class SiteScopedAgentDispatcher {
  private readonly stores = new Map<string, AgentWorkspaceStore>();
  forSite(siteId?: SiteId): AgentWorkspaceStore { const key = siteId ?? 'global'; let store = this.stores.get(key); if (!store) { store = new AgentWorkspaceStore(); this.stores.set(key, store); } return store; }
}
