import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonSyncOutboxStore } from '../src/infrastructure/sync-outbox.ts';

test('JSON sync outbox survives restart and persists retry state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-outbox-'));
  const path = join(root, 'sync', 'outbox.json');
  const first = new JsonSyncOutboxStore(path);
  await first.enqueue({ id: 'entry-1', objects: {}, attempts: 0, nextAttemptAt: 0 });
  const second = new JsonSyncOutboxStore(path);
  assert.equal((await second.list()).length, 1);
  const failed = await second.flush({ async push() { throw new Error('offline'); }, async pull() { return { objects: {} }; } });
  assert.deepEqual(failed.failed, ['entry-1']);
  const third = new JsonSyncOutboxStore(path);
  assert.equal((await third.list(Number.MAX_SAFE_INTEGER))[0].attempts, 1);
  await assert.rejects(() => third.enqueue({ id: '../escape', objects: {}, attempts: 0, nextAttemptAt: 0 }), /invalid/);
});

test('JSON sync outbox cancellation preserves unprocessed entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-outbox-cancel-'));
  const path = join(root, 'sync', 'outbox.json');
  const store = new JsonSyncOutboxStore(path);
  await store.enqueue({ id: 'first', objects: {}, attempts: 0, nextAttemptAt: 0 });
  await store.enqueue({ id: 'second', objects: {}, attempts: 0, nextAttemptAt: 0 });
  const controller = new AbortController();
  const result = await store.flush({
    async push() { controller.abort(); },
    async pull() { return { objects: {} }; },
  }, Date.now(), { signal: controller.signal });
  assert.deepEqual(result.succeeded, ['first']);
  assert.equal(result.cancelled, true);
  assert.deepEqual((await store.list(Number.MAX_SAFE_INTEGER)).map((entry) => entry.id), ['second']);
});
