import { DomainError } from '../domain/errors.ts';

/** Reject obvious SSRF targets before a user-provided URL reaches fetch(). */
export function publicHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new DomainError('validation', 'A public HTTP URL is required');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new DomainError('validation', 'A public HTTP URL is required'); }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const privateIpv4 = host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.startsWith('169.254.');
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || host === 'localhost' || host.endsWith('.local') || host === '::1' || host === '0.0.0.0' || host === '127.0.0.1' || privateIpv4) {
    throw new DomainError('security', 'Private, credentialed or non-HTTP URLs are not allowed');
  }
  return parsed.toString();
}
