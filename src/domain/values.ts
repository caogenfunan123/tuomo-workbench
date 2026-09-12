import { createHash, randomUUID } from 'node:crypto';
import { DomainError, assertDomain } from './errors.ts';

export type ArticleId = string & { readonly __brand: 'ArticleId' };
export type SiteId = string & { readonly __brand: 'SiteId' };
export type RemoteId = string & { readonly __brand: 'RemoteId' };
export type Revision = number;

export function newId(): string { return randomUUID(); }
export function articleId(value = newId()): ArticleId {
  assertDomain(/^[a-zA-Z0-9_-]{1,100}$/.test(value), 'Invalid article id');
  return value as ArticleId;
}
export function siteId(value = newId()): SiteId {
  assertDomain(/^[a-zA-Z0-9_-]{1,100}$/.test(value), 'Invalid site id');
  return value as SiteId;
}

export class SafeRelativePath {
  readonly value: string;

  private constructor(value: string) { this.value = value; }

  static parse(input: string): SafeRelativePath {
    if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
      throw new DomainError('security', 'Path must be a non-empty UTF-8 relative path');
    }
    const normalized = input.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
      throw new DomainError('security', 'Absolute paths are not allowed', { input });
    }
    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '..' || segment === '.' || segment === '')) {
      throw new DomainError('security', 'Path traversal and empty path segments are not allowed', { input });
    }
    return new SafeRelativePath(segments.join('/'));
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

export function contentHash(value: unknown): string { return sha256(stableJson(value)); }

export type SecretRef = {
  readonly id: string;
  readonly kind: 'credential' | 'apiKey' | 'password' | 'header' | 'encryptionKey';
  readonly label: string;
};

export function makeSecretRef(kind: SecretRef['kind'], label: string, id = newId()): SecretRef {
  assertDomain(label.trim().length > 0, 'Secret label cannot be empty');
  assertDomain(/^[a-zA-Z0-9_-]{1,100}$/.test(id), 'Invalid secret reference id');
  return Object.freeze({ id, kind, label: label.trim() });
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
