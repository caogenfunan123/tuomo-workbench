import { DomainError } from '../domain/errors.ts';
import { ToolExecutor, ToolRegistry } from '../domain/tools.ts';
import type { ToolDefinition, ToolHandler } from '../domain/tools.ts';
import type { SiteId } from '../domain/values.ts';
import { newId } from '../domain/values.ts';

export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string };
export type ChatToolCall = { id: string; toolId: string; input: Record<string, unknown> };
export type ModelCandidate = { id: string; group: string; priority: number; healthy: boolean; failures: number; contextLimit: number };
export type ChatRequest = { message: string; sessionId: string; siteId?: SiteId; generation: number; signal?: AbortSignal };
export type ChatEvent = { type: 'token' | 'tool' | 'model-switch' | 'done'; value?: string; call?: ChatToolCall };

export interface LlmAdapter { stream(messages: ChatMessage[], model: ModelCandidate, signal?: AbortSignal, tools?: ToolDefinition[]): AsyncIterable<ChatEvent>; }

export class ModelRouter {
  private readonly failures = new Map<string, number>();
  private readonly candidates: ModelCandidate[];
  constructor(candidates: ModelCandidate[]) { this.candidates = candidates; }
  choose(group: string, excluded: readonly string[] = []): ModelCandidate {
    const excludedIds = new Set(excluded);
    const all = this.candidates.filter((candidate) => candidate.group === group && candidate.healthy);
    const filtered = all.filter((candidate) => !excludedIds.has(candidate.id));
    const choices = (filtered.length ? filtered : all).sort((a, b) => (a.priority - b.priority) || ((this.failures.get(a.id) ?? a.failures) - (this.failures.get(b.id) ?? b.failures)));
    if (!choices[0]) throw new DomainError('network', `No healthy model in group: ${group}`);
    return choices[0];
  }
  fail(model: ModelCandidate): void { this.failures.set(model.id, (this.failures.get(model.id) ?? model.failures) + 1); }
  succeed(model: ModelCandidate): void { this.failures.delete(model.id); }
  health(modelId: string): number { return this.failures.get(modelId) ?? 0; }
}

export type AgentSession = { id: string; siteId?: SiteId; history: ChatMessage[]; summary: string; budget: number; state: 'active' | 'cancelled' | 'done' };
export interface AgentSessionStore { load(id: string): Promise<AgentSession | undefined>; save(session: AgentSession): Promise<void>; }

export class ChatUseCase {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly generations = new Map<string, number>();
  private readonly router: ModelRouter;
  private readonly adapter: LlmAdapter;
  private readonly tools: ToolRegistry;
  private readonly executor: ToolExecutor;
  private readonly handlers: Map<string, ToolHandler>;
  private readonly sessionStore?: AgentSessionStore;
  constructor(router: ModelRouter, adapter: LlmAdapter, tools: ToolRegistry, executor: ToolExecutor, handlers: Map<string, ToolHandler> = new Map(), sessionStore?: AgentSessionStore) { this.router = router; this.adapter = adapter; this.tools = tools; this.executor = executor; this.handlers = handlers; this.sessionStore = sessionStore; }

  session(id = newId(), siteId?: SiteId): AgentSession { const value = { id, siteId, history: [], summary: '', budget: 16, state: 'active' as const }; this.sessions.set(id, value); return value; }
  cancel(sessionId: string): void { const session = this.sessions.get(sessionId); if (session) session.state = 'cancelled'; this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1); }
  async *run(request: ChatRequest): AsyncGenerator<ChatEvent> {
    let session = this.sessions.get(request.sessionId);
    if (!session && this.sessionStore) { const restored = await this.sessionStore.load(request.sessionId); if (restored) { session = structuredClone(restored); this.sessions.set(request.sessionId, session); } }
    if (!session) throw new DomainError('notFound', 'Agent session not found');
    const currentGeneration = this.generations.get(request.sessionId) ?? 0;
    if (request.generation < currentGeneration) return;
    this.generations.set(request.sessionId, request.generation);
    const generation = request.generation;
    session.state = 'active';
    session.history.push({ role: 'user', content: request.message });
    this.compact(session);
    await this.sessionStore?.save(session);
    let model = this.router.choose('default');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        for (let loop = 0; loop < 8; loop++) {
          const assistantTokens: string[] = [];
          const calls: ChatToolCall[] = [];
          const availableTools = this.tools.list().filter((tool) => tool.enabled && (tool.scope === 'global' || tool.siteId === request.siteId));
          for await (const event of this.adapter.stream(this.messagesForModel(session, model), model, request.signal, availableTools)) {
            if (generation !== (this.generations.get(request.sessionId) ?? 0) || request.signal?.aborted) { session.state = 'cancelled'; return; }
            if (event.type === 'done') continue;
            if (event.type === 'token' && event.value) assistantTokens.push(event.value);
            if (event.type === 'tool' && event.call) calls.push(event.call);
            yield event;
          }
          if (!calls.length) {
            if (assistantTokens.length) session.history.push({ role: 'assistant', content: assistantTokens.join('') });
            await this.sessionStore?.save(session);
            this.router.succeed(model); session.state = 'done'; yield { type: 'done' }; return;
          }
          session.history.push({ role: 'assistant', content: assistantTokens.join('') });
          for (const call of calls) {
            if (session.budget-- <= 0) throw new DomainError('rateLimited', 'Agent budget exceeded');
            const handler = this.handlers.get(call.toolId) ?? (async () => { throw new DomainError('unsupported', `No handler configured for tool: ${call.toolId}`); });
            const result = await this.executor.execute({ toolId: call.toolId, input: call.input, siteId: request.siteId, sessionId: request.sessionId, signal: request.signal }, handler);
            const value = typeof result === 'string' ? result : JSON.stringify(result);
            session.history.push({ role: 'tool', content: value, toolCallId: call.id });
            this.compact(session);
            await this.sessionStore?.save(session);
            yield { type: 'tool', value, call };
          }
        }
        throw new DomainError('rateLimited', 'Tool loop limit exceeded');
      } catch (error) {
        if (error instanceof DomainError && !['network', 'rateLimited'].includes(error.kind)) throw error;
        this.router.fail(model); if (attempt === 1) throw error; yield { type: 'model-switch', value: model.id }; model = this.router.choose('default', [model.id]);
      }
    }
  }

  private messagesForModel(session: AgentSession, model: ModelCandidate): ChatMessage[] {
    const maxChars = Math.max(512, model.contextLimit * 4);
    const selected: ChatMessage[] = [];
    let used = 0;
    for (const message of [...session.history].reverse()) {
      if (selected.length >= 4 || used + message.content.length <= maxChars) {
        selected.unshift(message);
        used += message.content.length;
      }
      if (used >= maxChars) break;
    }
    const summary = session.summary ? session.summary.slice(-Math.floor(maxChars / 2)) : '';
    return summary ? [{ role: 'system', content: `Earlier conversation summary:\n${summary}` }, ...selected] : selected;
  }
  private compact(session: AgentSession): void {
    const maxMessages = 24;
    const maxChars = 40_000;
    const total = session.history.reduce((sum, message) => sum + message.content.length, 0);
    if (session.history.length <= maxMessages && total <= maxChars) return;
    const keep = Math.max(8, Math.floor(maxMessages / 2));
    const removed = session.history.splice(0, Math.max(0, session.history.length - keep));
    const digest = removed.map((message) => `${message.role}: ${message.content.slice(0, 500)}`).join('\n');
    session.summary = `${session.summary ? `${session.summary}\n` : ''}${digest}`.slice(-12_000);
  }
}
