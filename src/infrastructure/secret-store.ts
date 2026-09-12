import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { makeSecretRef } from '../domain/values.ts';
import type { SecretRef } from '../domain/values.ts';
import type { SecretStore } from '../application/ports.ts';

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  async put(value: string, ref?: SecretRef): Promise<SecretRef> { const next = ref ?? makeSecretRef('credential', 'secret'); this.values.set(next.id, value); return next; }
  async get(ref: SecretRef): Promise<string | undefined> { return this.values.get(ref.id); }
  async delete(ref: SecretRef): Promise<void> { this.values.delete(ref.id); }
}

type Envelope = { version: 1; entries: Record<string, { ref: SecretRef; iv: string; tag: string; ciphertext: string }> };

export class EncryptedFileSecretStore implements SecretStore {
  private readonly entries = new Map<string, Envelope['entries'][string]>();
  private loaded = false;
  private readonly path: string;
  private readonly key: Uint8Array;
  constructor(path: string, key: Uint8Array) { this.path = path; this.key = key; if (key.byteLength !== 32) throw new Error('EncryptedFileSecretStore key must be 32 bytes'); }
  async put(value: string, ref?: SecretRef): Promise<SecretRef> { await this.load(); const next = ref ?? makeSecretRef('credential', 'secret'); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); this.entries.set(next.id, { ref: next, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }); await this.flush(); return next; }
  async get(ref: SecretRef): Promise<string | undefined> { await this.load(); const entry = this.entries.get(ref.id); if (!entry) return undefined; const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(entry.iv, 'base64')); decipher.setAuthTag(Buffer.from(entry.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, 'base64')), decipher.final()]).toString('utf8'); }
  async delete(ref: SecretRef): Promise<void> { await this.load(); this.entries.delete(ref.id); await this.flush(); }
  private async load(): Promise<void> { if (this.loaded) return; this.loaded = true; try { const envelope = JSON.parse(await fs.readFile(this.path, 'utf8')) as Envelope; for (const [id, entry] of Object.entries(envelope.entries ?? {})) this.entries.set(id, entry); } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
  private async flush(): Promise<void> { const envelope: Envelope = { version: 1, entries: Object.fromEntries(this.entries) }; const tmp = `${this.path}.${process.pid}.tmp`; await fs.mkdir(dirname(this.path), { recursive: true }); await fs.writeFile(tmp, JSON.stringify(envelope, null, 2), { flag: 'w' }); await fs.rename(tmp, this.path); }
}
