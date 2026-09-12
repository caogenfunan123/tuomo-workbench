import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import type { UserPreferences } from '../application/content-tools.ts';
import type { GatewayRequestOptions } from '../application/ports.ts';

export class JsonSettingsStore {
  private readonly path: string;
  constructor(path: string) { this.path = path; }
  async read(): Promise<UserPreferences | undefined> { try { const value = JSON.parse(await fs.readFile(this.path, 'utf8')) as UserPreferences; validatePublicPreferences(value); return value; } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; } }
  async write(preferences: UserPreferences): Promise<void> { validatePublicPreferences(preferences); const temporary = `${this.path}.${process.pid}.tmp`; await fs.mkdir(dirname(this.path), { recursive: true }); await fs.writeFile(temporary, JSON.stringify(preferences, null, 2), { flag: 'w' }); await fs.rename(temporary, this.path); }
}

function validatePublicPreferences(preferences: UserPreferences): void {
  if (!preferences || !['simple', 'standard'].includes(preferences.mode) || !Array.isArray(preferences.pinned) || !Array.isArray(preferences.hidden) || (preferences.language !== undefined && !['zh-CN', 'en-US'].includes(preferences.language))) throw new DomainError('validation', 'Invalid public settings');
  if (preferences.proxyUrl) {
    let proxy: URL;
    try { proxy = new URL(preferences.proxyUrl); } catch { throw new DomainError('validation', 'Proxy URL is invalid'); }
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password) throw new DomainError('security', 'Proxy URL must be HTTP(S) without embedded credentials');
  }
  if (containsSecretKey(preferences)) throw new DomainError('security', 'Secrets must be stored through SecretStore, not public settings');
}
function containsSecretKey(value: unknown): boolean { if (Array.isArray(value)) return value.some(containsSecretKey); if (!value || typeof value !== 'object') return false; return Object.entries(value as Record<string, unknown>).some(([key, child]) => /(token|password|passwd|secret|api[-_]?key|authorization|cookie|header)/i.test(key) || containsSecretKey(child)); }

export type ReleaseInfo = { version: string; url?: string; notes?: string };
export class ReleaseManifestStore {
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  async read(): Promise<ReleaseInfo> {
    const value = JSON.parse(await fs.readFile(join(this.root, 'release.json'), 'utf8')) as ReleaseInfo;
    if (!value || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version)) throw new DomainError('validation', 'Invalid release manifest');
    if (value.url !== undefined && typeof value.url !== 'string') throw new DomainError('validation', 'Invalid release URL');
    if (value.notes !== undefined && typeof value.notes !== 'string') throw new DomainError('validation', 'Invalid release notes');
    return { version: value.version, ...(value.url ? { url: value.url } : {}), ...(value.notes ? { notes: value.notes } : {}) };
  }
}
export class UpdateChecker {
  private readonly fetchJson: (url: string, options?: GatewayRequestOptions) => Promise<ReleaseInfo>;
  constructor(fetchJson: (url: string, options?: GatewayRequestOptions) => Promise<ReleaseInfo>) { this.fetchJson = fetchJson; }
  async check(url: string, currentVersion: string, options: GatewayRequestOptions = {}): Promise<{ available: boolean; current: string; latest: ReleaseInfo }> { const latest = await this.fetchJson(url, options); return { available: compareVersions(latest.version, currentVersion) > 0, current: currentVersion, latest }; }
}
function compareVersions(a: string, b: string): number { const normalize = (value: string) => value.replace(/^v/, '').split(/[+-]/, 1)[0].split('.').map(Number); const left = normalize(a); const right = normalize(b); for (let index = 0; index < Math.max(left.length, right.length); index++) { const difference = (left[index] ?? 0) - (right[index] ?? 0); if (difference) return Math.sign(difference); } return 0; }
