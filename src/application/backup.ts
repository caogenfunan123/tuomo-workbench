import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath } from '../domain/values.ts';

export type BackupEntry = { path: string; data: string };
export type BackupArchive = { version: 1; encrypted: boolean; iv?: string; tag?: string; payload: string; manifestHash: string; createdAt: string };
export type RestorePlan = { entries: BackupEntry[]; conflicts: string[]; invalid: string[] };
export type WorkspaceBackupData = {
  settings: unknown;
  repos: unknown;
  drafts: unknown;
  templates: unknown;
  snippets: unknown;
  writingStats: unknown;
  sites: unknown;
  library?: unknown;
  skills?: unknown;
  themes?: unknown;
  agentSessions?: unknown;
  agentTasks?: unknown;
  syncManifest?: unknown;
  deviceKey?: string;
};

function manifest(entries: BackupEntry[]): string { return createHash('sha256').update(JSON.stringify(entries)).digest('hex'); }

export function createBackup(entries: BackupEntry[], key?: Uint8Array): BackupArchive {
  const normalized = entries.map((entry) => ({ path: SafeRelativePath.parse(entry.path).value, data: entry.data })).sort((a, b) => a.path.localeCompare(b.path));
  const raw = gzipSync(Buffer.from(JSON.stringify(normalized), 'utf8'));
  if (!key) return { version: 1, encrypted: false, payload: raw.toString('base64'), manifestHash: manifest(normalized), createdAt: new Date().toISOString() };
  if (key.byteLength !== 32) throw new DomainError('security', 'Backup key must be 32 bytes');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const payload = Buffer.concat([cipher.update(raw), cipher.final()]);
  return { version: 1, encrypted: true, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), payload: payload.toString('base64'), manifestHash: manifest(normalized), createdAt: new Date().toISOString() };
}

export function readBackup(archive: BackupArchive, key?: Uint8Array): BackupEntry[] {
  if (archive.version !== 1) throw new DomainError('unsupported', `Unsupported backup version: ${archive.version}`);
  let compressed = Buffer.from(archive.payload, 'base64');
  if (archive.encrypted) {
    if (!key || key.byteLength !== 32 || !archive.iv || !archive.tag) throw new DomainError('security', 'Encrypted backup requires a 32-byte key');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(archive.iv, 'base64')); decipher.setAuthTag(Buffer.from(archive.tag, 'base64')); compressed = Buffer.concat([decipher.update(compressed), decipher.final()]);
  }
  const entries = JSON.parse(gunzipSync(compressed).toString('utf8')) as BackupEntry[];
  const normalized = entries.map((entry) => ({ path: SafeRelativePath.parse(entry.path).value, data: entry.data })).sort((a, b) => a.path.localeCompare(b.path));
  if (manifest(normalized) !== archive.manifestHash) throw new DomainError('security', 'Backup manifest integrity check failed');
  return normalized;
}

export function planRestore(entries: BackupEntry[], existingPaths: Iterable<string>): RestorePlan {
  const existing = new Set(existingPaths); const safe: BackupEntry[] = []; const conflicts: string[] = []; const invalid: string[] = [];
  for (const entry of entries) {
    try { const path = SafeRelativePath.parse(entry.path).value; if (existing.has(path)) conflicts.push(path); else safe.push({ path, data: entry.data }); }
    catch { invalid.push(entry.path); }
  }
  return { entries: safe, conflicts, invalid };
}

export function createWorkspaceBackup(data: WorkspaceBackupData, key?: Uint8Array): BackupArchive {
  if (data.deviceKey && !key) throw new DomainError('security', 'Device key must be included only in an encrypted backup');
  const encode = (value: unknown): string => JSON.stringify(value ?? null);
  const entries: BackupEntry[] = [
    { path: 'settings/public.json', data: encode(data.settings) },
    { path: 'repos.json', data: encode(data.repos) },
    { path: 'drafts.json', data: encode(data.drafts) },
    { path: 'templates.json', data: encode(data.templates) },
    { path: 'snippets.json', data: encode(data.snippets) },
    { path: 'writing_stats.json', data: encode(data.writingStats) },
    { path: 'sites.json', data: encode(data.sites) },
  ];
  const optionalEntries: Array<[string, unknown]> = [
    ['writing/library.json', data.library],
    ['ai/skills.json', data.skills],
    ['themes/themes.json', data.themes],
    ['agent/sessions.json', data.agentSessions],
    ['agent/tasks.json', data.agentTasks],
    ['sync/manifest.json', data.syncManifest],
  ];
  for (const [path, value] of optionalEntries) {
    if (value !== undefined) entries.push({ path, data: encode(value) });
  }
  if (data.deviceKey) entries.push({ path: '.device_key', data: data.deviceKey });
  return createBackup(entries, key);
}

export function readWorkspaceBackup(archive: BackupArchive, key?: Uint8Array): WorkspaceBackupData {
  const values = new Map(readBackup(archive, key).map((entry) => [entry.path, entry.data]));
  const decode = (path: string): unknown => {
    const value = values.get(path);
    if (value === undefined) throw new DomainError('validation', `Workspace backup is missing ${path}`);
    try { return JSON.parse(value); } catch { throw new DomainError('validation', `Workspace backup entry is invalid: ${path}`); }
  };
  const decodeOptional = (path: string): unknown => {
    const value = values.get(path);
    if (value === undefined) return undefined;
    try { return JSON.parse(value); } catch { throw new DomainError('validation', `Workspace backup entry is invalid: ${path}`); }
  };
  return {
    settings: decode('settings/public.json'),
    repos: decode('repos.json'),
    drafts: decode('drafts.json'),
    templates: decode('templates.json'),
    snippets: decode('snippets.json'),
    writingStats: decode('writing_stats.json'),
    sites: decode('sites.json'),
    library: decodeOptional('writing/library.json'),
    skills: decodeOptional('ai/skills.json'),
    themes: decodeOptional('themes/themes.json'),
    agentSessions: decodeOptional('agent/sessions.json'),
    agentTasks: decodeOptional('agent/tasks.json'),
    syncManifest: decodeOptional('sync/manifest.json'),
    deviceKey: values.get('.device_key'),
  };
}
