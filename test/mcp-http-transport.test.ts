import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpMcpTransport } from '../src/infrastructure/mcp-http.ts';

test('HTTP and SSE MCP transports parse JSON-RPC responses', async () => { const json = new HttpMcpTransport('https://mcp.test', {}, async () => new Response(JSON.stringify({ result: { ok: true } }), { status: 200 })); assert.deepEqual(await json.request({ jsonrpc: '2.0', id: 1 }), { result: { ok: true } }); const sse = new HttpMcpTransport('https://mcp.test', {}, async () => new Response('event: message\ndata: {"result":{"ok":true}}\n\n', { status: 200 }), true); assert.deepEqual(await sse.request({ jsonrpc: '2.0', id: 1 }), { result: { ok: true } }); });
