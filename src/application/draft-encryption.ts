import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain/errors.ts';

export type EncryptedDraftEnvelope = { version: 1; algorithm: 'aes-256-gcm'; kdf: 'pbkdf2-sha256'; iterations: number; salt: string; iv: string; tag: string; verifier: string; ciphertext: string };
const ITERATIONS = 210_000;
const MAX_ITERATIONS = 1_000_000;

function keyFromPassword(password: string, salt: Buffer, iterations = ITERATIONS): Buffer {
  if (!password) throw new DomainError('security', 'Draft password cannot be empty');
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new DomainError('security', 'Draft encryption iterations are invalid');
  }
  if (salt.byteLength < 16) throw new DomainError('security', 'Draft encryption salt is invalid');
  return pbkdf2Sync(password, salt, iterations, 32, 'sha256');
}
function verifier(key: Buffer): string { return createHash('sha256').update('tuomo-draft-verifier-v1').update(key).digest('base64'); }

export function encryptDraft(plaintext: string, password: string): EncryptedDraftEnvelope { const salt = randomBytes(16); const iv = randomBytes(12); const key = keyFromPassword(password, salt); const cipher = createCipheriv('aes-256-gcm', key, iv); const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]); return { version: 1, algorithm: 'aes-256-gcm', kdf: 'pbkdf2-sha256', iterations: ITERATIONS, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), verifier: verifier(key), ciphertext: ciphertext.toString('base64') }; }
export function decryptDraft(envelope: EncryptedDraftEnvelope, password: string): string {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm' || envelope.kdf !== 'pbkdf2-sha256') {
    throw new DomainError('unsupported', 'Unsupported draft encryption envelope');
  }
  try {
    const key = keyFromPassword(password, Buffer.from(envelope.salt, 'base64'), envelope.iterations);
    const actual = Buffer.from(verifier(key));
    const expected = Buffer.from(envelope.verifier);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new DomainError('unauthorized', 'Draft password is incorrect');
    }
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (iv.byteLength !== 12 || tag.byteLength !== 16) {
      throw new DomainError('security', 'Draft authentication data is invalid');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('security', 'Draft authentication failed');
  }
}
