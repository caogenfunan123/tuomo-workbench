import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/application/ai.ts';
import { QuickWritingUseCase } from '../src/application/quick-actions.ts';
import { SiteScopedAgentDispatcher } from '../src/application/agent-workspace.ts';

const model = new ModelRouter([{ id: 'm', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 100 }]).choose('default');
test('quick writing actions stream and cancel stale generations', async () => {
  const action = new QuickWritingUseCase({ async *stream() { yield { type: 'token', value: 'a' as string }; await new Promise((resolve) => setTimeout(resolve, 5)); yield { type: 'token', value: 'b' as string }; } }); const values: string[] = []; const iterator = action.execute({ action: 'polish', text: 'text', model }); values.push((await iterator.next()).value.value); action.cancel(); const next = await iterator.next(); assert.equal(next.done, true); assert.deepEqual(values, ['a']);
});

test('agent workspaces are isolated by site', () => { const dispatcher = new SiteScopedAgentDispatcher(); const a = dispatcher.forSite('a' as any); const b = dispatcher.forSite('b' as any); const task = a.create('goal', 'a' as any); a.addChange(task.id, { path: 'x', operation: 'create', at: '' }); assert.equal(b.list().length, 0); assert.equal(a.get(task.id)?.changes.length, 1); });
