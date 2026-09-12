import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonAgentWorkspaceStore } from '../src/infrastructure/json-agent-workspace.ts';

test('JSON agent workspace persists task timeline, changes and site isolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-agent-workspace-'));
  try {
    const path = join(root, 'sites', 'site-a', 'tasks.json');
    const store = new JsonAgentWorkspaceStore(path);
    const task = await store.create('整理文章', 'site-a' as never, 'workspace');
    await store.append(task.id, { at: new Date().toISOString(), type: 'message', text: 'started' });
    await store.addChange(task.id, { path: 'posts/a.md', operation: 'update', at: new Date().toISOString() });
    await store.setState(task.id, 'done');
    const restored = new JsonAgentWorkspaceStore(path);
    const value = await restored.get(task.id);
    assert.equal(value?.state, 'done');
    assert.equal(value?.timeline.length, 1);
    assert.equal(value?.changes[0].path, 'posts/a.md');
    assert.equal((await restored.list('site-b' as never)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
