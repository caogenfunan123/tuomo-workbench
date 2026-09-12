import { DomainError } from '../domain/errors.ts';
import type { ChatEvent, LlmAdapter, ModelCandidate } from './ai.ts';

export type QuickAction = 'polish' | 'continue' | 'summary' | 'outline' | 'code' | 'rewrite-selection';
export type QuickActionRequest = { action: QuickAction; text: string; instruction?: string; model: ModelCandidate; signal?: AbortSignal };

function prompt(request: QuickActionRequest): string { const common = request.instruction ? `\n额外要求：${request.instruction}` : ''; switch (request.action) { case 'polish': return `请润色以下文本，保持原意和 Markdown 结构：\n${request.text}${common}`; case 'continue': return `请续写以下文本，保持语气和 Markdown 结构：\n${request.text}${common}`; case 'summary': return `请总结以下文本，输出简洁 Markdown 要点：\n${request.text}${common}`; case 'outline': return `请根据以下文本生成结构化 Markdown 大纲：\n${request.text}${common}`; case 'code': return `请根据以下需求生成可运行代码，并说明关键假设：\n${request.text}${common}`; case 'rewrite-selection': return `请只改写以下选区，保留 Markdown 语义：\n${request.text}${common}`; } }

export class QuickWritingUseCase {
  private generation = 0;
  private readonly adapter: LlmAdapter;
  constructor(adapter: LlmAdapter) { this.adapter = adapter; }
  cancel(): void { this.generation++; }
  async *execute(request: QuickActionRequest): AsyncGenerator<ChatEvent> { const current = ++this.generation; for await (const event of this.adapter.stream([{ role: 'user', content: prompt(request) }], request.model, request.signal)) { if (current !== this.generation || request.signal?.aborted) return; if (event.type === 'token') yield event; } }
}
