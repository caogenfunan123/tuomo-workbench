import test from 'node:test';
import assert from 'node:assert/strict';
import { StdioMcpTransport } from '../src/infrastructure/mcp-stdio.ts';

test('stdio MCP transport refuses commands outside explicit allow-list', async () => { const transport = new StdioMcpTransport('not-allowed', [], ['node'], () => true); await assert.rejects(() => transport.request({ jsonrpc: '2.0', id: 1 }), /allow-listed/); });

test('stdio MCP transport reuses one process and matches JSON-RPC ids', async () => {
  const script = "process.stdin.setEncoding('utf8'); let buffer=''; process.stdin.on('data', c => { buffer += c; let i; while ((i=buffer.indexOf('\\n')) >= 0) { const line=buffer.slice(0,i); buffer=buffer.slice(i+1); const message=JSON.parse(line); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{echo:message.id}})+'\\n'); } });";
  const transport = new StdioMcpTransport(process.execPath, ['-e', script], [process.execPath], () => true);
  try {
    const [first, second] = await Promise.all([
      transport.request({ jsonrpc: '2.0', id: 1, method: 'one' }),
      transport.request({ jsonrpc: '2.0', id: 2, method: 'two' }),
    ]);
    assert.equal((first.result as { echo: number }).echo, 1);
    assert.equal((second.result as { echo: number }).echo, 2);
  } finally {
    await transport.close();
  }
});

test('stdio MCP transport cancels an in-flight request', async () => {
  const script = "process.stdin.setEncoding('utf8'); process.stdin.on('data', c => setTimeout(() => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{ok:true}})+'\\n'), 1000));";
  const transport = new StdioMcpTransport(process.execPath, ['-e', script], [process.execPath], () => true);
  const controller = new AbortController();
  try {
    const pending = transport.request({ jsonrpc: '2.0', id: 1, method: 'slow' }, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20)); controller.abort();
    await assert.rejects(pending, (error: any) => error.kind === 'cancelled');
  } finally {
    await transport.close();
  }
});
