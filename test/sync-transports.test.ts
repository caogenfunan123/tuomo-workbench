import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { EncryptedObjectTransport, P2PPairingService, SyncOutbox, WebDavObjectTransport } from '../src/application/sync-transports.ts';
import { P2PDiscoveryService } from '../src/infrastructure/p2p-discovery.ts';
import { EncryptedP2PSyncTransport, P2PSyncHttpServer } from '../src/infrastructure/p2p-sync-http.ts';

test('WebDAV transport stores manifest and object payloads', async () => {
  const store = new Map<string, string>(); const transport = new WebDavObjectTransport('https://dav.test', async () => ({ authorization: 'Bearer ***' }), async (url, init) => { const key = new URL(url).pathname; if (init?.method === 'PUT') { store.set(key, String(init.body)); return new Response('{}', { status: 200 }); } const value = store.get(key); return value ? new Response(value, { status: 200 }) : new Response('{}', { status: 404 }); });
  await transport.push({ 'article:a': { payload: 'x', revision: 1, hash: 'h', modifiedAt: '' } });
  await transport.push({ 'article:b': { payload: 'y', revision: 1, hash: 'h', modifiedAt: '' } });
  const pulled = await transport.pull();
  assert.equal(pulled.objects['article:a'].payload, 'x');
  assert.equal(pulled.objects['article:b'].payload, 'y');
  assert.equal(Object.keys(await transport.importMissing([])).length, 2);
});

test('encrypted object transport hides payloads and checks hashes after decrypting', async () => {
  const raw = new Map<string, any>();
  const inner = { async pull() { return { objects: raw }; }, async push(objects: Record<string, any>) { Object.assign(raw, objects); } };
  const transport = new EncryptedObjectTransport(inner, new Uint8Array(32).fill(7));
  await transport.push({ 'article:a': { payload: 'private draft', revision: 1, hash: createHash('sha256').update('private draft').digest('hex'), modifiedAt: '' } });
  assert.doesNotMatch(raw['article:a'].payload, /private draft/);
  assert.equal((await transport.pull()).objects['article:a'].payload, 'private draft');
  raw['article:a'].payload = raw['article:a'].payload.replace(/.$/, 'x');
  await assert.rejects(() => transport.pull(), /decryption|hash mismatch/);
});

test('P2P pairing derives symmetric encrypted sessions and rejects wrong code', () => {
  const pairing = new P2PPairingService(); const { offer, accept } = pairing.createOffer(); const peer = pairing.acceptOffer(offer, offer.code); const owner = accept(peer.publicKey, offer.code); const text = owner.session.encrypt('secret'); assert.equal(peer.session.decrypt(text), 'secret'); assert.throws(() => pairing.acceptOffer(offer, '000000'), /mismatch/);
});

test('P2P production mode rejects an unencrypted transport', () => {
  const pairing = new P2PPairingService();
  const { offer } = pairing.createOffer();
  const peer = pairing.acceptOffer(offer, offer.code);
  assert.throws(() => new P2PSyncHttpServer(peer.session, async () => ({ objects: {} }), { requireTls: true }), /requires TLS/);
  assert.throws(() => new EncryptedP2PSyncTransport('http://127.0.0.1:1', peer.session, fetch, { requireTls: true }), /https endpoint/);
});

test('outbox retains failed objects for retry', async () => {
  const outbox = new SyncOutbox(); outbox.enqueue({ id: '1', objects: {}, attempts: 0, nextAttemptAt: 0 }); const result = await outbox.flush({ async push() { throw new Error('offline'); }, async pull() { return { objects: {} }; } }); assert.deepEqual(result.failed, ['1']); assert.equal(result.cancelled, false); assert.equal(outbox.list(Number.MAX_SAFE_INTEGER).length, 1);
});

test('outbox cancellation preserves unprocessed entries and reports partial progress', async () => {
  const outbox = new SyncOutbox();
  for (const id of ['a', 'b', 'c']) outbox.enqueue({ id, objects: {}, attempts: 0, nextAttemptAt: 0 });
  const controller = new AbortController();
  let calls = 0;
  const result = await outbox.flush({
    async push() { calls++; controller.abort(); },
    async pull() { return { objects: {} }; },
  }, 0, { concurrency: 1, signal: controller.signal });
  assert.equal(result.cancelled, true);
  assert.equal(calls, 1);
  assert.equal(outbox.list(Number.MAX_SAFE_INTEGER).length, 2);
});

test('UDP discovery validates fingerprints and removes expired announcements', async (t) => {
  const port = 40_000 + Math.floor(Math.random() * 1_000);
  const receiver = new P2PDiscoveryService(port);
  const sender = new P2PDiscoveryService(port);
  t.after(async () => { await receiver.close(); await sender.close(); });
  await receiver.start();
  const publicKey = Buffer.from('test-public-key').toString('base64');
  const fingerprint = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  await sender.announce({ deviceId: 'peer-a', port: 45_000, publicKey, fingerprint, expiresAt: Date.now() + 2_000 }, '127.0.0.1');
  for (let attempt = 0; attempt < 20 && receiver.list().length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(receiver.list()[0]?.deviceId, 'peer-a');
  assert.equal(receiver.list(Date.now() + 3_000).length, 0);
});

test('P2P HTTP transport only exchanges encrypted push and pull payloads', async (t) => {
  const pairing = new P2PPairingService();
  const { offer, accept } = pairing.createOffer();
  const peer = pairing.acceptOffer(offer, offer.code);
  const owner = accept(peer.publicKey, offer.code);
  const objects: Record<string, any> = {};
  const server = new P2PSyncHttpServer(peer.session, async (request) => {
    if (request.kind === 'push') Object.assign(objects, request.objects);
    return { objects };
  }, { trustedPeerFingerprints: [peer.peerFingerprint] });
  const port = await server.listen();
  t.after(() => server.close());
  const transport = new EncryptedP2PSyncTransport(`http://127.0.0.1:${port}`, owner.session, fetch, { peerFingerprint: owner.fingerprint });
  await transport.push({ 'article:one': { payload: 'draft', revision: 1, hash: 'hash', modifiedAt: '' } });
  assert.equal((await transport.pull()).objects['article:one'].payload, 'draft');
  const raw = await fetch(`http://127.0.0.1:${port}/sync`, { method: 'POST', body: JSON.stringify({ kind: 'pull' }) });
  assert.equal(raw.status, 401);
});
