import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditStore } from '../application/ports.ts';

const sensitive = /(bearer\s+)[^\s,;]+|(token|password|passwd|secret|api[-_]?key|cookie|authorization|mcp[-_ ]?header)(\s*[=:]\s*)[^\s,;]+/gi;
const sensitiveKey = /token|password|passwd|secret|api[-_]?key|cookie|authorization|mcp[-_ ]?header/i;

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(sensitive, (_match, prefix = '', key = '', separator = '') => prefix ? `${prefix}***` : `${key}${separator}***`);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitiveKey.test(key) ? '***' : redact(child)]));
  return value;
}

export class JsonlAuditStore implements AuditStore {
  private readonly path: string;
  constructor(path: string) { this.path = path; }
  async append(event: { action: string; subject?: string; details?: Record<string, unknown> }): Promise<void> { await fs.mkdir(dirname(this.path), { recursive: true }); const entry = { at: new Date().toISOString(), ...event, details: redact(event.details ?? {}) }; await fs.appendFile(this.path, `${JSON.stringify(entry)}\n`); }
}
