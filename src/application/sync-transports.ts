import { createCipheriv, createDecipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, randomInt } from 'node:crypto';
import { DomainError } from '../domain/errors.ts';
import { FetchJsonRequester } from './http-port.ts';
import type { FetchPort, JsonRequester } from './http-port.ts';
import type { GatewayRequestOptions, SyncTransport } from './ports.ts';

export type SyncObjectPayload = { payload: string; revision: number; hash: string; modifiedAt: string };
export type ObjectCredentialResolver = () => Promise<Record<string, string>>;

export class WebDavObjectTransport implements SyncTransport {
  private readonly client: JsonRequester;
  private readonly baseUrl: string;
  private readonly credential: ObjectCredentialResolver;
  constructor(baseUrl: string, credential: ObjectCredentialResolver = async () => ({}), requesterOrFetcher?: JsonRequester | FetchPort) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.credential = credential; this.client = typeof requesterOrFetcher === 'function' ? new FetchJsonRequester(requesterOrFetcher) : requesterOrFetcher ?? new FetchJsonRequester(); }
  async pull(options: GatewayRequestOptions = {}): Promise<{ objects: Record<string, SyncObjectPayload> }> {
    const headers = await this.credential(); let manifest: { keys?: string[] };
    try { manifest = await this.client.request<{ keys?: string[] }>(`${this.baseUrl}/manifest.json`, { method: 'GET', headers }, options); } catch (error) { if (error instanceof DomainError && error.kind === 'notFound') return { objects: {} }; throw error; }
    const objects: Record<string, SyncObjectPayload> = {}; for (const key of manifest.keys ?? []) objects[key] = await this.client.request<SyncObjectPayload>(`${this.baseUrl}/objects/${encodeURIComponent(key)}.json`, { method: 'GET', headers }, options); return { objects };
  }
  async push(objects: Record<string, SyncObjectPayload>, options: GatewayRequestOptions = {}): Promise<void> {
    const headers = { ...(await this.credential()), 'content-type': 'application/json' };
    for (const [key, object] of Object.entries(objects)) await this.client.request(`${this.baseUrl}/objects/${encodeURIComponent(key)}.json`, { method: 'PUT', headers, body: JSON.stringify(object) }, options);
    let existing: string[] = [];
    try { existing = (await this.client.request<{ keys?: string[] }>(`${this.baseUrl}/manifest.json`, { method: 'GET', headers }, options)).keys ?? []; }
    catch (error) { if (!(error instanceof DomainError) || error.kind !== 'notFound') throw error; }
    const keys = [...new Set([...existing, ...Object.keys(objects)])];
    await this.client.request(`${this.baseUrl}/manifest.json`, { method: 'PUT', headers, body: JSON.stringify({ keys, updatedAt: new Date().toISOString() }) }, options);
  }
  async importMissing(localKeys: Iterable<string>): Promise<Record<string, SyncObjectPayload>> { const remote = await this.pull(); const local = new Set(localKeys); return Object.fromEntries(Object.entries(remote.objects).filter(([key]) => !local.has(key))); }
}

export class EncryptedObjectTransport implements SyncTransport {
  private readonly inner: SyncTransport;
  private readonly key: Uint8Array;
  constructor(inner: SyncTransport, key: Uint8Array) { if (key.byteLength !== 32) throw new DomainError('security', 'Sync encryption key must be 32 bytes'); this.inner = inner; this.key = key; }
  async pull(options: GatewayRequestOptions = {}): Promise<{ objects: Record<string, SyncObjectPayload> }> {
    const remote = await this.inner.pull(options);
    const objects: Record<string, SyncObjectPayload> = {};
    for (const [key, object] of Object.entries(remote.objects)) {
      const payload = this.decrypt(object.payload);
      const actualHash = createHash('sha256').update(payload).digest('hex');
      if (actualHash !== object.hash) throw new DomainError('security', `Sync object hash mismatch: ${key}`);
      objects[key] = { ...object, payload };
    }
    return { objects };
  }
  async push(objects: Record<string, SyncObjectPayload>, options: GatewayRequestOptions = {}): Promise<void> {
    const encrypted: Record<string, SyncObjectPayload> = {};
    for (const [key, object] of Object.entries(objects)) encrypted[key] = { ...object, payload: this.encrypt(object.payload) };
    await this.inner.push(encrypted, options);
  }
  private encrypt(value: string): string { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }); }
  private decrypt(value: string): string { try { const envelope = JSON.parse(value) as { version: number; iv: string; tag: string; data: string }; if (envelope.version !== 1) throw new Error('unsupported envelope'); const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64')); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'); } catch { throw new DomainError('security', 'Sync object decryption failed'); } }
}

export type OutboxEntry = { id: string; objects: Record<string, SyncObjectPayload>; attempts: number; nextAttemptAt: number; lastError?: string };

export class SyncOutbox {
  private readonly entries = new Map<string, OutboxEntry>();
  enqueue(entry: OutboxEntry): void { this.entries.set(entry.id, structuredClone(entry)); }
  list(now = Date.now()): OutboxEntry[] { return [...this.entries.values()].filter((entry) => entry.nextAttemptAt <= now).map((entry) => structuredClone(entry)); }
  remove(id: string): void { this.entries.delete(id); }
  async flush(transport: SyncTransport, now = Date.now(), options: { concurrency?: number; signal?: AbortSignal } = {}): Promise<{ succeeded: string[]; failed: string[]; cancelled: boolean }> {
    const entries = this.list(now); const succeeded: string[] = []; const failed: string[] = []; let next = 0; let cancelled = false;
    const consume = async (): Promise<void> => {
      while (true) {
        if (options.signal?.aborted) { cancelled = true; return; }
        const index = next++;
        if (index >= entries.length) return;
        const entry = entries[index];
        try { await transport.push(entry.objects, { signal: options.signal }); this.remove(entry.id); succeeded.push(entry.id); }
        catch (error) { entry.attempts++; entry.lastError = error instanceof Error ? error.message : String(error); entry.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** entry.attempts); this.enqueue(entry); failed.push(entry.id); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, options.concurrency ?? 4), entries.length || 1) }, consume));
    return { succeeded, failed, cancelled };
  }
}

export type PairOffer = { code: string; publicKey: string; fingerprint: string; expiresAt: number };
export type PairAcceptance = { publicKey: string; fingerprint: string; peerFingerprint: string; session: EncryptedP2PSession };

export class P2PPairingService {
  createOffer(ttlMs = 5 * 60_000): { offer: PairOffer; accept: (publicKey: string, code: string) => PairAcceptance } {
    const keys = generateKeyPairSync('x25519'); const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'); const fingerprint = fingerprintFor(publicKey); const code = String(randomInt(100000, 1000000)); const offer = { code, publicKey, fingerprint, expiresAt: Date.now() + ttlMs };
    return { offer, accept: (remotePublicKey, remoteCode) => { if (Date.now() > offer.expiresAt) throw new DomainError('security', 'Pairing offer expired'); if (remoteCode !== code) throw new DomainError('security', 'Pairing code mismatch'); const remote = importPublic(remotePublicKey); const secret = diffieHellman({ privateKey: keys.privateKey, publicKey: remote }); return { publicKey, fingerprint, peerFingerprint: fingerprintFor(remotePublicKey), session: new EncryptedP2PSession(deriveSessionKey(secret)) }; } };
  }
  acceptOffer(offer: PairOffer, code: string): PairAcceptance { if (Date.now() > offer.expiresAt) throw new DomainError('security', 'Pairing offer expired'); if (code !== offer.code) throw new DomainError('security', 'Pairing code mismatch'); const keys = generateKeyPairSync('x25519'); const remote = importPublic(offer.publicKey); const secret = diffieHellman({ privateKey: keys.privateKey, publicKey: remote }); const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'); return { publicKey, fingerprint: fingerprintFor(publicKey), peerFingerprint: offer.fingerprint, session: new EncryptedP2PSession(deriveSessionKey(secret)) }; }
}

function importPublic(value: string) { return createPublicKey({ key: Buffer.from(value, 'base64'), type: 'spki', format: 'der' }); }
function fingerprintFor(publicKey: string): string { return createHash('sha256').update(publicKey).digest('hex').slice(0, 16); }
function deriveSessionKey(secret: Buffer): Buffer { return createHash('sha256').update('tuomo-p2p-v1').update(secret).digest(); }

export class EncryptedP2PSession {
  private readonly key: Uint8Array;
  constructor(key: Uint8Array) { this.key = key; if (key.byteLength !== 32) throw new DomainError('security', 'P2P session key must be 32 bytes'); }
  encrypt(value: string): string { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') }); }
  decrypt(payload: string): string { try { const envelope = JSON.parse(payload); const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64')); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'); } catch { throw new DomainError('security', 'P2P payload authentication failed'); } }
}
