import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProxyFetch, createSettingsAwareFetch } from '../src/infrastructure/proxy-fetch.ts';
import { JsonSettingsStore } from '../src/infrastructure/settings-store.ts';

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port');
  return address.port;
}

test('proxy fetch forwards absolute HTTP targets and buffered bodies', async () => {
  let seenUrl = '';
  let seenBody = '';
  const proxy = createServer((request, response) => {
    seenUrl = request.url ?? '';
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seenBody = Buffer.concat(chunks).toString('utf8');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
    });
  });
  const port = await listen(proxy);
  try {
    const result = await createProxyFetch(`http://127.0.0.1:${port}`)('http://origin.test/api', {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
    });
    assert.equal(result.status, 200);
    assert.equal(seenUrl, 'http://origin.test/api');
    assert.equal(seenBody, '{"hello":"world"}');
    assert.deepEqual(await result.json(), { ok: true });
  } finally {
    await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  }
});

test('settings-aware fetch applies the persisted proxy and refreshes it', async () => {
  const proxy = createServer((_request, response) => response.end('first-proxy'));
  const secondProxy = createServer((_request, response) => response.end('second-proxy'));
  const port = await listen(proxy);
  const secondPort = await listen(secondProxy);
  const root = await mkdtemp(join(tmpdir(), 'tuomo-proxy-'));
  try {
    const settings = new JsonSettingsStore(join(root, 'settings.json'));
    await settings.write({ mode: 'standard', pinned: [], hidden: [], theme: 'system', editorTheme: 'default', nightMode: false, proxyUrl: `http://127.0.0.1:${port}` });
    const fetcher = createSettingsAwareFetch(settings);
    assert.equal(await (await fetcher('http://origin.test/one')).text(), 'first-proxy');
    await settings.write({ mode: 'standard', pinned: [], hidden: [], theme: 'system', editorTheme: 'default', nightMode: false, proxyUrl: `http://127.0.0.1:${secondPort}` });
    assert.equal(await (await fetcher('http://origin.test/two')).text(), 'second-proxy');
  } finally {
    await rm(root, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => secondProxy.close((error) => error ? reject(error) : resolve()));
  }
});
