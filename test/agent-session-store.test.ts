import { strict as assert } from 'node:assert';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonAgentSessionStore } from '../src/infrastructure/agent-session-store.ts';

test('JSON agent session store survives restart and keeps site scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-agent-'));
  const path = join(root, 'sites', 'site-a', 'sessions.json');
  try {
    const store = new JsonAgentSessionStore(path);
    await store.save({ id: 'session-a', siteId: 'site-a' as never, history: [{ role: 'user', content: 'hello' }], summary: '', budget: 8, state: 'active' });
    await store.save({ id: 'session-b', siteId: 'site-b' as never, history: [], summary: 'other', budget: 4, state: 'done' });
    assert.equal((await store.list('site-a')).length, 1);
    assert.equal((await store.load('session-a'))?.history[0].content, 'hello');

    const restored = new JsonAgentSessionStore(path);
    assert.equal((await restored.load('session-b'))?.siteId, 'site-b');
    await restored.remove('session-a');
    assert.equal(await restored.load('session-a'), undefined);
    assert.match(await readFile(path, 'utf8'), /"schemaVersion": 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('JSON agent session store rejects path-like identifiers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-agent-invalid-'));
  try {
    const store = new JsonAgentSessionStore(join(root, 'sessions.json'));
    await assert.rejects(() => store.load('../secret'), (error: any) => error.kind === 'security');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
