import test from 'node:test';
import assert from 'node:assert/strict';
import { McpConnection } from '../src/application/mcp.ts';
import { HttpJsonClient } from '../src/infrastructure/http-client.ts';
import { FetchJsonRequester } from '../src/application/http-port.ts';

test('MCP initialize is allow-listed, authorization-gated and connection-reused', async () => {
  let calls = 0; const connection = new McpConnection({ kind: 'http', endpoint: 'https://tools.example.test/mcp', allowedHosts: ['tools.example.test'], enabled: true }, { async request() { calls++; return { result: { serverInfo: 'ok' } }; }, async close() {} });
  assert.deepEqual(await connection.initialize({ name: 'tuomo', version: '1' }), { serverInfo: 'ok' }); assert.deepEqual(await connection.initialize({ name: 'tuomo', version: '1' }), { serverInfo: 'ok' }); assert.equal(calls, 1);
  await assert.rejects(() => new McpConnection({ kind: 'stdio', endpoint: 'local', allowedHosts: [], enabled: true }, { async request() { return { result: {} }; }, async close() {} }).initialize({ name: 'x', version: '1' }), /authorization/);
});

test('HTTP client adds request id and classifies JSON errors', async () => {
  let seen = ''; const client = new HttpJsonClient(async (_url, init) => { seen = new Headers(init?.headers).get('x-request-id') ?? ''; return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
  assert.deepEqual(await client.request('https://example.test'), { ok: true }); assert.match(seen, /^[0-9a-f-]{36}$/);
});

test('HTTP text requests retain request id and retry transient failures', async () => {
  let calls = 0; let seen = '';
  const client = new HttpJsonClient(async (_url, init) => {
    calls++; seen = new Headers(init?.headers).get('x-request-id') ?? '';
    return calls === 1 ? new Response('busy', { status: 503 }) : new Response('plain text', { status: 200 });
  });
  const response = await client.requestText('https://example.test/text', {}, { retries: 1 });
  assert.equal(response.body, 'plain text'); assert.equal(response.status, 200); assert.equal(calls, 2); assert.match(seen, /^[0-9a-f-]{36}$/);
});

test('HTTP retry backoff is cancellable', async () => {
  const controller = new AbortController(); let calls = 0;
  const client = new HttpJsonClient(async () => { calls++; return new Response('busy', { status: 503 }); });
  const pending = client.requestText('https://example.test/text', {}, { retries: 2, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0)); controller.abort();
  await assert.rejects(pending, (error: any) => error.kind === 'cancelled'); assert.equal(calls, 1);
});

test('HTTP client does not replay POST side effects by default', async () => {
  let calls = 0;
  const client = new HttpJsonClient(async () => { calls++; return new Response('busy', { status: 503 }); });
  await assert.rejects(() => client.requestText('https://example.test/create', { method: 'POST' }), (error: any) => error.kind === 'network');
  assert.equal(calls, 1);
});

test('HTTP requesters surface cancellation instead of retrying it', async () => {
  const controller = new AbortController();
  const fetcher = async (_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }); controller.signal.addEventListener('abort', () => init?.signal && (init.signal as AbortSignal).dispatchEvent(new Event('abort')), { once: true }); });
  const client = new HttpJsonClient(fetcher);
  const pending = client.request('https://example.test', {}, { signal: controller.signal, retries: 2 });
  controller.abort();
  await assert.rejects(pending, (error: any) => error.kind === 'cancelled');
  const requester = new FetchJsonRequester(fetcher);
  const second = new AbortController(); second.abort();
  await assert.rejects(() => requester.request('https://example.test', {}, { signal: second.signal }), (error: any) => error.kind === 'cancelled');
});
