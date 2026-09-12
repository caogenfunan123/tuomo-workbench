import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatUseCase, ModelRouter } from '../src/application/ai.ts';
import { ToolExecutor, ToolRegistry } from '../src/domain/tools.ts';
import { ApiKeyPool, ProtocolLlmAdapter, ToolLoopUseCase } from '../src/application/llm.ts';

test('OpenAI-compatible adapter maps messages and streams normalized tokens', async () => {
  let request = ''; const adapter = new ProtocolLlmAdapter({ id: 'x', protocol: 'openai-chat', endpoint: 'https://llm.test/v1', apiKey: 'secret', model: 'm' }, async (_url, init) => { request = String(init?.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), { status: 200 }); });
  const events = []; for await (const event of adapter.stream([{ role: 'user', content: 'hi' }], { id: 'm', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 100 })) events.push(event); assert.match(request, /"model":"m"/); assert.equal(events[0].value, 'hello');
});

test('LLM protocol adapter maps Responses and Anthropic envelopes', async () => {
  const requests: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const responses = [
    new Response(JSON.stringify({ output_text: 'responses answer', output: [] }), { status: 200 }),
    new Response(JSON.stringify({ content: [{ type: 'text', text: 'anthropic answer' }] }), { status: 200 }),
  ];
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) });
    return responses.shift()!;
  };
  const model = { id: 'model', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 100 } as const;
  const responseAdapter = new ProtocolLlmAdapter({ id: 'responses', protocol: 'openai-responses', endpoint: 'https://llm.test/v1', apiKey: 'responses-key', model: 'model' }, fetcher);
  const responseEvents = [];
  for await (const event of responseAdapter.stream([{ role: 'user', content: 'hello' }], model)) responseEvents.push(event);
  const anthropicAdapter = new ProtocolLlmAdapter({ id: 'anthropic', protocol: 'anthropic', endpoint: 'https://llm.test/v1', apiKey: 'anthropic-key', model: 'model' }, fetcher);
  const anthropicEvents = [];
  for await (const event of anthropicAdapter.stream([{ role: 'system', content: 'rules' }, { role: 'user', content: 'hello' }], model)) anthropicEvents.push(event);
  assert.match(requests[0].url, /\/responses$/);
  assert.equal(requests[0].body.input[0].role, 'user');
  assert.equal(requests[0].headers.authorization, 'Bearer responses-key');
  assert.match(requests[1].url, /\/messages$/);
  assert.equal(requests[1].body.system, 'rules');
  assert.equal(requests[1].headers['x-api-key'], 'anthropic-key');
  assert.equal(responseEvents[0].value, 'responses answer');
  assert.equal(anthropicEvents[0].value, 'anthropic answer');
});

test('tool loop executes tools with a bounded budget and appends results', async () => {
  let count = 0; const result = await new ToolLoopUseCase(3).run('go', { history: [], budget: 3 }, new ModelRouter([{ id: 'm', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 100 }]).choose('default'), { async complete() { count++; return count === 1 ? { text: '', toolCalls: [{ id: '1', toolId: 'read', input: {} }] } : { text: 'done', toolCalls: [] }; } }, async () => 'tool result'); assert.equal(result, 'done'); assert.equal(count, 2);
});

test('chat use case executes protocol tool calls through policy and audit', async () => {
  const requests: any[] = [];
  let responseCount = 0;
  const adapter = new ProtocolLlmAdapter({ id: 'x', protocol: 'openai-chat', endpoint: 'https://llm.test/v1', model: 'm' }, async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    responseCount++;
    const response = responseCount === 1 ? { choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{"path":"draft.md"}' } }] } }] } : { choices: [{ message: { content: 'done' } }] };
    return new Response(JSON.stringify(response), { status: 200 });
  });
  const registry = new ToolRegistry();
  registry.register({ id: 'read', kind: 'file', scope: 'global', params: { path: 'safe-path' }, risk: 'read', enabled: true });
  const executor = new ToolExecutor(registry);
  const chat = new ChatUseCase(new ModelRouter([{ id: 'm', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 100 }]), adapter, registry, executor, new Map([['read', async (call) => ({ path: call.input.path, content: 'hello' })]]));
  const session = chat.session('agent');
  const events = [];
  for await (const event of chat.run({ message: '读取草稿', sessionId: session.id, generation: 0 })) events.push(event);
  assert.equal(events.at(-1)?.type, 'done');
  assert.equal(executor.audits.at(-1)?.result, 'success');
  assert.equal(session.history.at(-1)?.content, 'done');
  assert.equal(requests[0].tools[0].function.name, 'read');
  assert.match(requests[1].messages.at(-1).content, /hello/);
});

test('model router selects a fallback after a recoverable provider failure', () => {
  const router = new ModelRouter([
    { id: 'primary', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 100 },
    { id: 'backup', group: 'default', priority: 2, healthy: true, failures: 0, contextLimit: 100 },
  ]);
  const primary = router.choose('default');
  router.fail(primary);
  assert.equal(router.choose('default', [primary.id]).id, 'backup');
  assert.equal(router.health('primary'), 1);
  router.succeed(primary);
  assert.equal(router.health('primary'), 0);
});

test('chat sessions persist and compact long histories without sharing sites', async () => {
  const stored = new Map<string, any>();
  const adapter = { async *stream(messages: any[]) { yield { type: 'token', value: messages.at(-1).content.slice(0, 5) }; yield { type: 'done' }; } } as any;
  const registry = new ToolRegistry();
  const chat = new ChatUseCase(new ModelRouter([{ id: 'm', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 100 }]), adapter, registry, new ToolExecutor(registry), new Map(), { async load(id) { return stored.get(id); }, async save(session) { stored.set(session.id, structuredClone(session)); } });
  const session = chat.session('persisted', 'site-a' as any);
  for (let i = 0; i < 30; i++) for await (const _event of chat.run({ message: `message-${i}`, sessionId: session.id, generation: i })) { /* consume */ }
  assert.ok(session.summary.length > 0);
  assert.equal(stored.get('persisted').siteId, 'site-a');
  assert.equal((await new Promise<any>((resolve) => resolve(stored.get('persisted')))).siteId, 'site-a');
});

test('API key pool rotates after failure and resets a recovered key', () => {
  let now = 1000;
  const pool = new ApiKeyPool(['a', 'b'], () => now);
  assert.equal(pool.acquire(), 'a');
  pool.fail('a', 100);
  assert.equal(pool.acquire(), 'b');
  pool.succeed('a');
  assert.equal(pool.health().find((item) => item.key === 'a')?.failures, 0);
  now += 1000;
  assert.equal(pool.acquire(), 'a');
});
