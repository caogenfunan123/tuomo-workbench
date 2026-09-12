import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptDraft, decryptDraft } from '../src/application/draft-encryption.ts';
import { ChatUseCase, ModelRouter } from '../src/application/ai.ts';
import { ToolLoopUseCase } from '../src/application/llm.ts';
import { SyncUseCase } from '../src/application/sync.ts';
import { EncryptedObjectTransport, EncryptedP2PSession, P2PPairingService, SyncOutbox, WebDavObjectTransport } from '../src/application/sync-transports.ts';
import type { JsonRequester } from '../src/application/http-port.ts';
import type { SyncObjectPayload, SyncTransport } from '../src/application/ports.ts';
import { DomainError } from '../src/domain/errors.ts';
import { ToolExecutor, ToolRegistry, SessionToolAuthorization } from '../src/domain/tools.ts';
import { SafeRelativePath, articleId, makeSecretRef, siteId } from '../src/domain/values.ts';

test('encryption rejects malformed envelopes before crypto work', () => {
  const envelope = encryptDraft('secret', 'password');
  assert.throws(() => decryptDraft({ ...envelope, version: 2 }, 'password'), (error: any) => error.kind === 'unsupported');
  assert.throws(() => decryptDraft({ ...envelope, iterations: 0 }, 'password'), (error: any) => error.kind === 'security');
  assert.throws(() => decryptDraft({ ...envelope, salt: Buffer.from('short').toString('base64') }, 'password'), (error: any) => error.kind === 'security');
  assert.throws(() => decryptDraft({ ...envelope, tag: Buffer.from('bad').toString('base64') }, 'password'), (error: any) => error.kind === 'security');
  assert.throws(() => decryptDraft(envelope, ''), (error: any) => error.kind === 'security');
});

test('tool policy validates scopes, structured inputs, expiry and cancellation', async () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.register({ id: 'bad scope', kind: 'file', scope: 'global', params: {}, risk: 'read', enabled: true }), /identity/);
  assert.throws(() => registry.register({ id: 'invalid-scope', kind: 'file', scope: 'other' as never, params: {}, risk: 'read', enabled: true }), /scope/);
  assert.throws(() => registry.register({ id: 'invalid-type', kind: 'file', scope: 'global', params: { value: 'boolean' }, risk: 'read', enabled: true }), /parameter type/);
  registry.register({ id: 'read', kind: 'file', scope: 'global', params: { path: 'safe-path', amount: 'number' }, risk: 'read', enabled: true });
  assert.throws(() => registry.register({ id: 'read', kind: 'file', scope: 'global', params: {}, risk: 'read', enabled: true }), /already registered/);
  const executor = new ToolExecutor(registry);
  await assert.rejects(() => executor.execute({ toolId: 'read', input: { path: 1, amount: 1 }, sessionId: 's' }, () => 'no'), /must be a string/);
  await assert.rejects(() => executor.execute({ toolId: 'read', input: { path: 'a.md', amount: Number.NaN }, sessionId: 's' }, () => 'no'), /finite number/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => executor.execute({ toolId: 'read', input: { path: 'a.md', amount: 1 }, sessionId: 's', signal: controller.signal }, () => 'no'), /cancelled/);

  let now = 100;
  const authorization = new SessionToolAuthorization(() => now);
  const write = { id: 'write', kind: 'repo', scope: 'global' as const, params: {}, risk: 'external-write' as const, enabled: true };
  assert.throws(() => authorization.grant('', write.id), /invalid/);
  assert.equal(authorization.authorize(write, { toolId: write.id, input: {}, sessionId: 's' }), false);
  authorization.grant('s', write.id, 10);
  assert.equal(authorization.authorize(write, { toolId: write.id, input: {}, sessionId: 's' }), true);
  now = 111;
  assert.equal(authorization.authorize(write, { toolId: write.id, input: {}, sessionId: 's' }), false);
  authorization.grant('s', write.id);
  authorization.revoke('s');
  assert.equal(authorization.authorize(write, { toolId: write.id, input: {}, sessionId: 's' }), false);
});

class MemoryRequester implements JsonRequester {
  readonly values = new Map<string, unknown>();
  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    if (init.method === 'PUT') {
      this.values.set(url, init.body ? JSON.parse(String(init.body)) : null);
      return {} as T;
    }
    if (!this.values.has(url)) throw new DomainError('notFound', 'missing');
    return structuredClone(this.values.get(url)) as T;
  }
}

test('WebDAV and encrypted transports handle empty remotes, manifests and tampering', async () => {
  const requester = new MemoryRequester();
  const transport = new WebDavObjectTransport('https://dav.example.test/root', async () => ({ authorization: 'Bearer secret' }), requester);
  assert.deepEqual(await transport.pull(), { objects: {} });
  await transport.push({ 'article:a': { payload: 'one', revision: 1, hash: 'hash', modifiedAt: '' } });
  const pulled = await transport.pull();
  assert.equal(pulled.objects['article:a'].payload, 'one');
  assert.deepEqual(Object.keys(await transport.importMissing(['article:other'])), ['article:a']);

  const key = new Uint8Array(32).fill(7);
  requester.values.clear();
  const encrypted = new EncryptedObjectTransport(transport, key);
  await encrypted.push({ 'article:b': { payload: 'private', revision: 1, hash: 'placeholder', modifiedAt: '' } });
  const raw = requester.values.get('https://dav.example.test/root/objects/article%3Ab.json') as SyncObjectPayload;
  const expectedHash = (await import('node:crypto')).createHash('sha256').update('private').digest('hex');
  requester.values.set('https://dav.example.test/root/objects/article%3Ab.json', { ...raw, hash: expectedHash });
  assert.equal((await encrypted.pull()).objects['article:b'].payload, 'private');
  requester.values.set('https://dav.example.test/root/objects/article%3Ab.json', { ...raw, hash: 'wrong' });
  await assert.rejects(() => encrypted.pull(), /hash mismatch/);
  assert.throws(() => new EncryptedObjectTransport(transport, new Uint8Array(1)), /32 bytes/);
});

test('sync outbox retries failed objects and honors cancellation', async () => {
  const outbox = new SyncOutbox();
  outbox.enqueue({ id: 'ok', objects: { value: { payload: 'ok', revision: 1, hash: 'hash', modifiedAt: '' } }, attempts: 0, nextAttemptAt: 0 });
  outbox.enqueue({ id: 'fail', objects: {}, attempts: 0, nextAttemptAt: 0 });
  const transport: SyncTransport = {
    async pull() { return { objects: {} }; },
    async push(objects) {
      if (objects && Object.keys(objects).length === 0) throw new Error('remote down');
    },
  };
  const failed = await outbox.flush(transport, 100);
  assert.deepEqual(failed.succeeded, ['ok']);
  assert.deepEqual(failed.failed, ['fail']);
  assert.equal(outbox.list(3000)[0].attempts, 1);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await outbox.flush(transport, 100, { signal: controller.signal });
  assert.equal(cancelled.cancelled, true);
});

test('P2P pairing requires the short code and produces an authenticated session', () => {
  const pairing = new P2PPairingService();
  const offer = pairing.createOffer();
  assert.throws(() => pairing.acceptOffer(offer.offer, '000000'), /mismatch/);
  const remote = pairing.acceptOffer(offer.offer, offer.offer.code);
  const local = offer.accept(remote.publicKey, offer.offer.code);
  const payload = local.session.encrypt('hello');
  assert.equal(remote.session.decrypt(payload), 'hello');
  assert.throws(() => new EncryptedP2PSession(new Uint8Array(1)), /32 bytes/);
  const expired = pairing.createOffer(-1);
  assert.throws(() => expired.accept(remote.publicKey, expired.offer.code), /expired/);
});

test('value objects reject unsafe identifiers, paths and secret references', () => {
  assert.throws(() => articleId('../bad'), /article id/);
  assert.throws(() => siteId(''), /site id/);
  for (const value of ['', '../x', './x', '/x', 'C:/x', 'a//b', 'a/\0b']) {
    assert.throws(() => SafeRelativePath.parse(value), /Path|Absolute|traversal|empty/);
  }
  assert.throws(() => makeSecretRef('apiKey', 'label', '../bad'), /secret reference/);
  assert.equal(SafeRelativePath.parse('posts\\draft.md').value, 'posts/draft.md');
  assert.equal((SyncUseCase.object('article', 'a', 'payload', 1, 'device') as any).hash.length, 64);
});

test('AI loop and model router fail safely at their hard limits', async () => {
  assert.throws(() => new ModelRouter([{ id: 'bad', group: 'other', priority: 1, healthy: true, failures: 0, contextLimit: 10 }]).choose('default'), /No healthy/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => new ToolLoopUseCase().run('hello', { history: [], budget: 1 }, { id: 'm', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 10 }, { async complete() { return { text: 'done', toolCalls: [] }; } }, async () => 'unused', controller.signal), /cancelled/);
  await assert.rejects(() => new ToolLoopUseCase(1).run('hello', { history: [], budget: 3 }, { id: 'm', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 10 }, { async complete() { return { text: '', toolCalls: [{ id: '1', toolId: 'read', input: {} }] }; } }, async () => 'tool'), /loop limit/);
});

test('chat switches once after a network failure and preserves policy errors', async () => {
  const registry = new ToolRegistry();
  let calls = 0;
  const adapter = {
    async *stream() {
      calls++;
      if (calls === 1) throw new DomainError('network', 'primary offline');
      yield { type: 'token' as const, value: 'backup' };
      yield { type: 'done' as const };
    },
  };
  const chat = new ChatUseCase(
      new ModelRouter([
        { id: 'primary', group: 'default', priority: 1, healthy: true, failures: 0, contextLimit: 100 },
        { id: 'backup', group: 'default', priority: 2, healthy: true, failures: 0, contextLimit: 100 },
      ]),
      adapter,
      registry,
      new ToolExecutor(registry));
  const session = chat.session('fallback');
  const events = [];
  for await (const event of chat.run({ message: 'hello', sessionId: session.id, generation: 0 })) events.push(event);
  assert.equal(events.some((event) => event.type === 'model-switch'), true);
  assert.equal(events.at(-1)?.type, 'done');
  assert.equal(session.history.at(-1)?.content, 'backup');
});
