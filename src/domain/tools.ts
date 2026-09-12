import { DomainError } from './errors.ts';
import { SafeRelativePath, newId } from './values.ts';
import type { SiteId } from './values.ts';

export type ToolRisk = 'read' | 'external-read' | 'external-write' | 'delete' | 'deploy' | 'create-repository' | 'local-process';
export type ToolScope = 'global' | 'site';

export type ToolDefinition = {
  id: string;
  kind: string;
  scope: ToolScope;
  siteId?: SiteId;
  params: Record<string, string>;
  risk: ToolRisk;
  enabled: boolean;
  secretRefs?: string[];
};

export type ToolCall = { toolId: string; input: Record<string, unknown>; siteId?: SiteId; sessionId: string; signal?: AbortSignal };
export type ToolAudit = { id: string; toolId: string; sessionId: string; siteId?: SiteId; inputSummary: string; result: 'allowed' | 'denied' | 'failed' | 'success'; durationMs: number; error?: string; at: string };

export type ToolAuthorization = (tool: ToolDefinition, call: ToolCall) => Promise<boolean> | boolean;

export class SessionToolAuthorization {
  private readonly grants = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) { this.now = now; }

  grant(sessionId: string, toolId: string, ttlMs = 15 * 60_000): void {
    if (!sessionId.trim() || !toolId.trim() || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new DomainError('validation', 'Tool authorization grant is invalid');
    }
    this.grants.set(`${sessionId}:${toolId}`, this.now() + ttlMs);
  }

  revoke(sessionId: string, toolId?: string): void {
    if (toolId) this.grants.delete(`${sessionId}:${toolId}`);
    else for (const key of this.grants.keys()) if (key.startsWith(`${sessionId}:`)) this.grants.delete(key);
  }

  authorize(tool: ToolDefinition, call: ToolCall): boolean {
    if (tool.risk === 'read') return true;
    const key = `${call.sessionId}:${tool.id}`;
    const expiresAt = this.grants.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.now()) { this.grants.delete(key); return false; }
    return true;
  }
}

export function validateToolInput(tool: ToolDefinition, input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) if (!(key in tool.params)) throw new DomainError('validation', `Unknown tool parameter: ${key}`);
  for (const [key, type] of Object.entries(tool.params)) {
    if (!(key in input)) throw new DomainError('validation', `Missing tool parameter: ${key}`);
    if (type === 'string' && typeof input[key] !== 'string') throw new DomainError('validation', `Tool parameter ${key} must be a string`);
    if (type === 'number' && (typeof input[key] !== 'number' || !Number.isFinite(input[key] as number))) throw new DomainError('validation', `Tool parameter ${key} must be a finite number`);
    if (type === 'safe-path') {
      if (typeof input[key] !== 'string') throw new DomainError('validation', `Tool parameter ${key} must be a string`);
      SafeRelativePath.parse(input[key]);
    }
  }
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  register(definition: ToolDefinition): void {
    if (this.definitions.has(definition.id)) throw new DomainError('validation', `Tool already registered: ${definition.id}`);
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(definition.id) || !definition.kind.trim()) throw new DomainError('validation', 'Tool identity is invalid');
    if (!['global', 'site'].includes(definition.scope)) throw new DomainError('validation', 'Tool scope is invalid');
    if (definition.scope === 'site' && !definition.siteId) throw new DomainError('validation', 'Site-scoped tool requires siteId');
    if (!['read', 'external-read', 'external-write', 'delete', 'deploy', 'create-repository', 'local-process'].includes(definition.risk)) throw new DomainError('validation', 'Tool risk is invalid');
    for (const type of Object.values(definition.params)) if (!['string', 'number', 'safe-path'].includes(type)) throw new DomainError('validation', `Unsupported tool parameter type: ${type}`);
    this.definitions.set(definition.id, Object.freeze({ ...definition, params: { ...definition.params } }));
  }
  get(id: string): ToolDefinition | undefined { return this.definitions.get(id); }
  list(): ToolDefinition[] { return [...this.definitions.values()]; }
}

export type ToolHandler = (call: ToolCall) => Promise<unknown> | unknown;

export class ToolExecutor {
  readonly audits: ToolAudit[] = [];
  private readonly registry: ToolRegistry;
  private readonly authorize: ToolAuthorization;
  constructor(registry: ToolRegistry, authorize: ToolAuthorization = (tool) => tool.risk === 'read') { this.registry = registry; this.authorize = authorize; }

  async execute(call: ToolCall, handler: ToolHandler): Promise<unknown> {
    if (call.signal?.aborted) throw new DomainError('cancelled', 'Tool execution cancelled');
    const tool = this.registry.get(call.toolId);
    if (!tool || !tool.enabled) throw new DomainError('notFound', `Tool unavailable: ${call.toolId}`);
    if (tool.scope === 'site' && (!tool.siteId || tool.siteId !== call.siteId)) throw new DomainError('security', 'Tool is outside the current site scope');
    validateToolInput(tool, call.input);
    const started = Date.now();
    const allowed = await this.authorize(tool, call);
    if (!allowed) {
      this.audits.push(this.audit(call, 'denied', Date.now() - started));
      throw new DomainError('unauthorized', `Tool authorization required: ${tool.id}`);
    }
    try {
      const result = await handler(call);
      this.audits.push(this.audit(call, 'success', Date.now() - started));
      return result;
    } catch (error) {
      this.audits.push({ ...this.audit(call, 'failed', Date.now() - started), error: redactToolError(error instanceof Error ? error.message : String(error)) });
      throw error;
    }
  }

  private audit(call: ToolCall, result: ToolAudit['result'], durationMs: number): ToolAudit {
    return { id: newId(), toolId: call.toolId, sessionId: call.sessionId, siteId: call.siteId, inputSummary: '[redacted structured input]', result, durationMs, at: new Date().toISOString() };
  }
}

function redactToolError(value: string): string { return value.replace(/bearer\s+[^\s,;]+/gi, 'Bearer ***').replace(/(token|password|secret|api[-_]?key|cookie|authorization)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2***'); }
