import { DomainError } from '../domain/errors.ts';
import type { ChatEvent, ChatMessage, ChatToolCall, LlmAdapter, ModelCandidate } from './ai.ts';
import type { ToolDefinition } from '../domain/tools.ts';
import { FetchJsonRequester } from './http-port.ts';
import type { FetchPort, JsonRequester } from './http-port.ts';

export type LlmProtocol = 'openai-chat' | 'openai-responses' | 'anthropic';
export type LlmProviderConfig = { id: string; protocol: LlmProtocol; endpoint: string; apiKey?: string; keyPool?: ApiKeyPool; headers?: Record<string, string>; model: string; timeoutMs?: number };

export const BUILTIN_PROVIDERS: Record<string, Omit<LlmProviderConfig, 'apiKey' | 'model'>> = {
  openai: { id: 'openai', protocol: 'openai-chat', endpoint: 'https://api.openai.com/v1', headers: {} },
  'openai-responses': { id: 'openai-responses', protocol: 'openai-responses', endpoint: 'https://api.openai.com/v1', headers: {} },
  deepseek: { id: 'deepseek', protocol: 'openai-chat', endpoint: 'https://api.deepseek.com/v1', headers: {} },
  siliconflow: { id: 'siliconflow', protocol: 'openai-chat', endpoint: 'https://api.siliconflow.cn/v1', headers: {} },
  moonshot: { id: 'moonshot', protocol: 'openai-chat', endpoint: 'https://api.moonshot.cn/v1', headers: {} },
  ollama: { id: 'ollama', protocol: 'openai-chat', endpoint: 'http://localhost:11434/v1', headers: {} },
  azure: { id: 'azure', protocol: 'openai-chat', endpoint: '', headers: {} },
  hunyuan: { id: 'hunyuan', protocol: 'openai-chat', endpoint: 'https://api.hunyuan.cloud.tencent.com/v1', headers: {} },
  bailian: { id: 'bailian', protocol: 'openai-chat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', headers: {} },
  volcengine: { id: 'volcengine', protocol: 'openai-chat', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', headers: {} },
  anthropic: { id: 'anthropic', protocol: 'anthropic', endpoint: 'https://api.anthropic.com/v1', headers: {} },
  gemini: { id: 'gemini', protocol: 'openai-chat', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', headers: {} },
};

export type ApiKeyState = { key: string; failures: number; cooldownUntil: number };
export class ApiKeyPool {
  private readonly values: ApiKeyState[];
  private cursor = 0;
  private readonly now: () => number;
  constructor(keys: string[], now: () => number = () => Date.now()) {
    const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
    if (!unique.length) throw new DomainError('validation', 'At least one API key is required');
    this.values = unique.map((key) => ({ key, failures: 0, cooldownUntil: 0 }));
    this.now = now;
  }
  acquire(): string {
    const time = this.now();
    const available = this.values.filter((value) => value.cooldownUntil <= time);
    const candidates = available.length ? available : this.values;
    const ordered = candidates.map((_, index) => candidates[(this.cursor + index) % candidates.length]);
    const selected = ordered.sort((left, right) => left.failures - right.failures)[0];
    this.cursor = (this.values.indexOf(selected) + 1) % this.values.length;
    return selected.key;
  }
  succeed(key: string): void { const value = this.values.find((item) => item.key === key); if (value) { value.failures = 0; value.cooldownUntil = 0; } }
  fail(key: string, cooldownMs = 30_000): void { const value = this.values.find((item) => item.key === key); if (value) { value.failures++; value.cooldownUntil = this.now() + cooldownMs * Math.min(value.failures, 8); } }
  health(): ApiKeyState[] { return this.values.map((value) => ({ ...value })); }
}

export class ProtocolLlmAdapter implements LlmAdapter {
  private readonly client: JsonRequester;
  private readonly config: LlmProviderConfig;
  constructor(config: LlmProviderConfig, requesterOrFetcher?: JsonRequester | FetchPort) { this.config = config; this.client = typeof requesterOrFetcher === 'function' ? new FetchJsonRequester(requesterOrFetcher) : requesterOrFetcher ?? new FetchJsonRequester(); }
  async *stream(messages: ChatMessage[], model: ModelCandidate, signal?: AbortSignal, tools: ToolDefinition[] = []): AsyncIterable<ChatEvent> {
    if (signal?.aborted) throw new DomainError('cancelled', 'LLM request cancelled');
    const key = this.config.keyPool?.acquire();
    try {
      const result = await this.client.request<any>(this.endpoint(), { method: 'POST', headers: this.headers(key), body: JSON.stringify(this.body(messages, model, tools)) }, { signal, timeoutMs: this.config.timeoutMs ?? 60_000, retries: 1 });
      this.config.keyPool?.succeed(key ?? '');
      if (signal?.aborted) throw new DomainError('cancelled', 'LLM request cancelled');
      const text = this.extractText(result); for (const chunk of text.match(/.{1,32}/gs) ?? ['']) if (chunk) yield { type: 'token', value: chunk }; for (const call of this.extractToolCalls(result)) yield { type: 'tool', call, value: call.toolId }; yield { type: 'done' };
    } catch (error) {
      if (key) this.config.keyPool?.fail(key);
      throw error;
    }
  }
  private endpoint(): string { return `${this.config.endpoint.replace(/\/$/, '')}${this.config.protocol === 'openai-chat' ? '/chat/completions' : this.config.protocol === 'openai-responses' ? '/responses' : '/messages'}`; }
  private headers(key = this.config.apiKey): Record<string, string> { const common = { 'content-type': 'application/json', ...this.config.headers }; if (this.config.protocol === 'anthropic') return { ...common, 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' }; return { ...common, ...(key ? { authorization: `Bearer ${key}` } : {}) }; }
  private body(messages: ChatMessage[], model: ModelCandidate, tools: ToolDefinition[]): Record<string, unknown> {
    const schemas = tools.map((tool) => ({ name: tool.id, description: `${tool.kind} (${tool.risk})`, parameters: { type: 'object', properties: Object.fromEntries(Object.entries(tool.params).map(([key, type]) => [key, { type: type === 'number' ? 'number' : 'string' }])), required: Object.keys(tool.params), additionalProperties: false } }));
    if (this.config.protocol === 'anthropic') { const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n'); const anthropicTools = schemas.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters })); return { model: this.config.model || model.id, max_tokens: model.contextLimit, ...(system ? { system } : {}), ...(anthropicTools.length ? { tools: anthropicTools } : {}), messages: messages.filter((message) => message.role !== 'system').map(({ role, content }) => ({ role: role === 'tool' ? 'user' : role, content })) }; }
    if (this.config.protocol === 'openai-responses') return { model: this.config.model || model.id, input: messages.map(({ role, content }) => ({ role, content })), ...(schemas.length ? { tools: schemas.map((schema) => ({ type: 'function', ...schema })) } : {}), stream: false };
    return { model: this.config.model || model.id, messages, ...(schemas.length ? { tools: schemas.map((schema) => ({ type: 'function', function: schema })) } : {}), stream: false };
  }
  private extractText(result: any): string { if (typeof result === 'string') return result; if (this.config.protocol === 'openai-responses') return String(result.output_text ?? result.output?.filter((item: any) => item.type !== 'function_call').map((item: any) => item.content?.map((part: any) => part.text ?? '').join('')).join('') ?? ''); if (this.config.protocol === 'anthropic') return String(result.content?.filter((part: any) => part.type === 'text').map((part: any) => part.text ?? '').join('') ?? ''); return String(result.choices?.[0]?.message?.content ?? ''); }
  private extractToolCalls(result: any): ChatToolCall[] {
    const values = this.config.protocol === 'openai-responses' ? (result.output ?? []).filter((item: any) => item.type === 'function_call').map((item: any) => ({ id: item.call_id ?? item.id, name: item.name, arguments: item.arguments })) : this.config.protocol === 'anthropic' ? (result.content ?? []).filter((item: any) => item.type === 'tool_use').map((item: any) => ({ id: item.id, name: item.name, arguments: item.input })) : (result.choices?.[0]?.message?.tool_calls ?? []).map((item: any) => ({ id: item.id, name: item.function?.name, arguments: item.function?.arguments }));
    return values.filter((value: any) => value.id && value.name).map((value: any) => ({ id: String(value.id), toolId: String(value.name), input: typeof value.arguments === 'string' ? JSON.parse(value.arguments || '{}') : (value.arguments ?? {}) }));
  }
}

export type ToolCallRequest = { id: string; toolId: string; input: Record<string, unknown> };
export type Completion = { text: string; toolCalls: ToolCallRequest[] };
export interface CompletionAdapter { complete(messages: ChatMessage[], model: ModelCandidate, signal?: AbortSignal): Promise<Completion>; }

export class ToolLoopUseCase {
  private readonly maxLoops: number;
  private readonly maxTokens: number;
  constructor(maxLoops = 8, maxTokens = 32_000) { this.maxLoops = maxLoops; this.maxTokens = maxTokens; }
  async run(message: string, session: { history: ChatMessage[]; budget: number }, model: ModelCandidate, adapter: CompletionAdapter, execute: (call: ToolCallRequest, signal?: AbortSignal) => Promise<string>, signal?: AbortSignal): Promise<string> {
    session.history.push({ role: 'user', content: message }); let loops = 0; let used = 0;
    while (loops++ < this.maxLoops) {
      if (signal?.aborted) throw new DomainError('cancelled', 'Agent request cancelled'); const completion = await adapter.complete(session.history, model, signal); used += completion.text.length; if (used > this.maxTokens || session.budget-- <= 0) throw new DomainError('rateLimited', 'Agent budget exceeded');
      if (!completion.toolCalls.length) { session.history.push({ role: 'assistant', content: completion.text }); return completion.text; }
      for (const call of completion.toolCalls) { const result = await execute(call, signal); session.history.push({ role: 'tool', content: result, toolCallId: call.id }); }
    }
    throw new DomainError('rateLimited', 'Tool loop limit exceeded');
  }
}
