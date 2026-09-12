import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { DomainError } from '../domain/errors.ts';
import { makeSecretRef } from '../domain/values.ts';
import type { SecretRef } from '../domain/values.ts';
import type { SecretStore, AuditStore } from './ports.ts';
import { createArticle } from '../domain/article.ts';
import type { Article, ArticleMetadata } from '../domain/article.ts';
import { createStaticSite } from '../domain/site.ts';
import type { StaticFramework } from '../domain/site.ts';
import { SafeRelativePath } from '../domain/values.ts';

type Json = Record<string, any>;
const legacyFiles = ['settings.json', 'repos.json', 'drafts.json', 'drafts.json.enc', 'templates.json', 'snippets.json', 'writing_stats.json', '.device_key'];
const secretKey = /(token|password|passwd|secret|api[-_]?key|authorization|cookie|header)/i;
const frameworks: StaticFramework[] = ['hexo', 'hugo', 'jekyll', 'vuepress', 'gatsby', 'nextjs', 'astro', 'pelican', '11ty'];

export type MigrationReport = { migrated: string[]; skipped: string[]; backups: string[]; secretRefs: string[]; convertedArticles: string[]; convertedTemplates: string[]; convertedSnippets: string[]; convertedStats: string[]; convertedSites: string[]; schemaVersion: number; backupKeyRef?: SecretRef };

async function exists(path: string): Promise<boolean> { try { await fs.access(path); return true; } catch { return false; } }
async function readJson(path: string): Promise<Json | undefined> { try { return JSON.parse(await fs.readFile(path, 'utf8')) as Json; } catch { return undefined; } }
function hashFile(data: string | Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }

export class LegacyMigrationUseCase {
  private readonly secrets: SecretStore;
  private readonly audit?: AuditStore;
  private backupKey?: Uint8Array;
  private backupKeyRef?: SecretRef;
  private libraryWasPresent = false;
  constructor(secrets: SecretStore, audit?: AuditStore) { this.secrets = secrets; this.audit = audit; }

  async execute(legacyRoot: string, targetRoot: string): Promise<MigrationReport> {
    this.backupKey = undefined;
    this.backupKeyRef = undefined;
    this.libraryWasPresent = await exists(join(targetRoot, 'writing', 'library.json'));
    await fs.mkdir(targetRoot, { recursive: true });
    await this.loadExistingBackupKey(targetRoot);
    await this.assertCapacity(legacyRoot, targetRoot);
    const report: MigrationReport = { migrated: [], skipped: [], backups: [], secretRefs: [], convertedArticles: [], convertedTemplates: [], convertedSnippets: [], convertedStats: [], convertedSites: [], schemaVersion: 1 };
    report.backupKeyRef = this.backupKeyRef;
    const backupRoot = join(targetRoot, '.migration-backups', new Date().toISOString().replaceAll(':', '-'));
    for (const name of legacyFiles) {
      const source = join(legacyRoot, name);
      if (!await exists(source)) { report.skipped.push(name); continue; }
      if ((await fs.lstat(source)).isSymbolicLink()) throw new DomainError('security', `Legacy source cannot be a symbolic link: ${name}`);
      const raw = await fs.readFile(source);
      const backup = join(backupRoot, name);
      await this.writeBackup(backup, raw, report, name === '.device_key' || name.endsWith('.enc') || secretKey.test(raw.toString('utf8')));
      if (name.endsWith('.enc')) {
        // The legacy envelope may require a user password that is not
        // available during unattended migration. Preserve it in the new
        // workspace so an explicit unlock/import can decode it later.
        await this.atomicWrite(join(targetRoot, 'legacy-import', name), raw);
        report.migrated.push(name);
        continue;
      }
      if (name === '.device_key') {
        const value = raw.toString('utf8').trim();
        if (value) {
          const ref = makeSecretRef('encryptionKey', 'legacy.device-key');
          await this.secrets.put(value, ref);
          const outputName = join(targetRoot, 'legacy-import', '.device_key.ref.json');
          await this.atomicWrite(outputName, JSON.stringify(ref, null, 2));
          report.secretRefs.push(ref.id);
        }
        report.migrated.push(name);
        await this.audit?.append({ action: 'migration.file', subject: name, details: { sha256: hashFile(raw.toString('utf8')), backup } });
        continue;
      }
      const parsed = name === '.device_key' ? undefined : await readJson(source);
      if (parsed) {
        const { publicData, refs } = await this.extractSecrets(parsed, report);
        const outputName = name === 'settings.json' ? join(targetRoot, 'settings', 'public.json') : join(targetRoot, 'legacy-import', name);
        await fs.mkdir(dirname(outputName), { recursive: true });
        await this.atomicWrite(outputName, JSON.stringify(publicData, null, 2));
        if (name === 'drafts.json') await this.convertLegacyDrafts(publicData, targetRoot, report);
        if (name === 'templates.json') await this.convertLegacyTemplates(publicData, targetRoot, report);
        if (name === 'snippets.json') await this.convertLegacySnippets(publicData, targetRoot, report);
        if (name === 'writing_stats.json') await this.convertLegacyStats(publicData, targetRoot, report);
        if (name === 'repos.json') await this.convertLegacyRepositories(publicData, targetRoot, report);
        report.migrated.push(name);
        report.secretRefs.push(...refs);
      } else {
        const outputName = join(targetRoot, 'legacy-import', name);
        await fs.mkdir(dirname(outputName), { recursive: true });
        await this.atomicWrite(outputName, raw);
        report.migrated.push(name);
      }
      await this.audit?.append({ action: 'migration.file', subject: name, details: { sha256: hashFile(raw.toString('utf8')), backup } });
    }
    const legacySites = join(legacyRoot, 'sites');
    if (await exists(legacySites)) await this.migrateSites(legacySites, join(targetRoot, 'sites'), join(backupRoot, 'sites'), report);
    await this.atomicWrite(join(targetRoot, 'meta', 'schema.json'), JSON.stringify({ schemaVersion: report.schemaVersion, migratedAt: new Date().toISOString(), backups: report.backups, backupKeyRef: report.backupKeyRef }, null, 2));
    await this.audit?.append({ action: 'migration.complete', details: { migrated: report.migrated.length, secretRefs: report.secretRefs.length } });
    return report;
  }

  async readBackup(path: string, keyRef: SecretRef): Promise<Uint8Array> {
    const envelope = JSON.parse(await fs.readFile(path, 'utf8')) as { version: number; iv: string; tag: string; data: string };
    if (envelope.version !== 1) throw new DomainError('unsupported', 'Unsupported migration backup version');
    const encodedKey = await this.secrets.get(keyRef);
    if (!encodedKey) throw new DomainError('notFound', 'Migration backup key is unavailable');
    try {
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(encodedKey, 'base64'), Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    } catch { throw new DomainError('security', 'Migration backup authentication failed'); }
  }

  private async assertCapacity(legacyRoot: string, targetRoot: string): Promise<void> {
    const sourceBytes = await directoryBytes(legacyRoot);
    const requiredBytes = Math.max(1_048_576, sourceBytes * 3);
    try {
      const stats = await fs.statfs(targetRoot);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      if (Number.isFinite(availableBytes) && availableBytes < requiredBytes) {
        throw new DomainError('storage', `Insufficient free space for migration: need ${requiredBytes} bytes`);
      }
      await this.audit?.append({ action: 'migration.capacity', details: { sourceBytes, requiredBytes, availableBytes } });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      // Some filesystems do not expose statfs; migration remains safe because
      // every destination is written atomically and the source is retained.
    }
  }

  private async loadExistingBackupKey(targetRoot: string): Promise<void> {
    const schema = await readJson(join(targetRoot, 'meta', 'schema.json'));
    const ref = secretRef(schema?.backupKeyRef);
    if (!ref) return;
    this.backupKeyRef = ref;
    const encoded = await this.secrets.get(ref);
    if (!encoded) throw new DomainError('security', 'Existing migration backup key is unavailable');
    const key = Buffer.from(encoded, 'base64');
    if (key.byteLength !== 32) throw new DomainError('security', 'Existing migration backup key is invalid');
    this.backupKey = key;
  }

  private async migrateSites(sourceRoot: string, targetRoot: string, backupRoot: string, report: MigrationReport, relative = ''): Promise<void> {
    for (const entry of await fs.readdir(join(sourceRoot, relative), { withFileTypes: true })) {
      const childRelative = relative ? join(relative, entry.name) : entry.name; const source = join(sourceRoot, childRelative); const backup = join(backupRoot, childRelative); const target = join(targetRoot, childRelative);
      if (entry.isSymbolicLink()) throw new DomainError('security', `Legacy site entry cannot be a symbolic link: ${childRelative}`);
      if (entry.isDirectory()) { await this.migrateSites(sourceRoot, targetRoot, backupRoot, report, childRelative); continue; }
      const raw = await fs.readFile(source); await this.writeBackup(backup, raw, report, entry.name.endsWith('.enc') || secretKey.test(raw.toString('utf8')));
      if (entry.name.endsWith('.json')) { const parsed = await readJson(source); if (parsed) { const extracted = await this.extractSecrets(parsed, report, `sites.${childRelative}`); await this.atomicWrite(target, JSON.stringify(extracted.publicData, null, 2)); report.secretRefs.push(...extracted.refs); report.migrated.push(`sites/${childRelative}`); continue; } }
      await this.atomicWrite(target, raw); report.migrated.push(`sites/${childRelative}`);
    }
  }

  private async convertLegacyDrafts(value: unknown, targetRoot: string, report: MigrationReport): Promise<void> {
    const entries = legacyDraftEntries(value);
    if (entries.length === 0) return;
    const articlesRoot = join(targetRoot, 'articles');
    const indexPath = join(articlesRoot, 'index.json');
    const existingValue = await readJson<unknown>(indexPath);
    const existing: Array<{ id: string }> = Array.isArray(existingValue)
      ? existingValue.filter((item): item is { id: string } => isRecord(item) && typeof item.id === 'string')
      : [];
    const known = new Set(existing.map((item) => item.id));
    const summaries: Array<Record<string, unknown>> = [...existing];
    for (const entry of entries) {
      const article = legacyDraftToArticle(entry, known);
      if (!article || known.has(article.id)) continue;
      const articlePath = join(articlesRoot, `${article.id}.json`);
      if (await exists(articlePath)) continue;
      await this.atomicWrite(articlePath, JSON.stringify(article, null, 2));
      summaries.push({
        id: article.id,
        title: article.title,
        updatedAt: article.updatedAt,
        localRevision: article.localRevision,
        published: article.published,
        metadata: article.metadata,
      });
      known.add(article.id);
      report.convertedArticles.push(article.id);
    }
    if (report.convertedArticles.length > 0) {
      await this.replaceAtomicWrite(indexPath, JSON.stringify(summaries, null, 2));
    }
  }

  private async convertLegacyTemplates(value: unknown, targetRoot: string, report: MigrationReport): Promise<void> {
    const entries = legacyCollection(value, ['templates', 'items']);
    if (entries.length === 0) return;
    const library = await readLibrary(targetRoot);
    const known = new Set(library.templates.map((template) => template.id));
    for (const entry of entries) {
      const id = legacyId(firstString(entry.id, entry.templateId), `legacy-template-${hashFile(JSON.stringify(entry)).slice(0, 16)}`);
      if (known.has(id)) continue;
      const framework = normalizeFramework(firstString(entry.framework, entry.frameworkId, entry.engine)) ?? 'hexo';
      const kind = firstString(entry.kind, entry.type) === 'page' ? 'page' : 'post';
      const frontMatter = firstString(entry.frontMatter, entry.template, entry.content, entry.body) ?? '---\ntitle: {{title}}\n---';
      library.templates.push({
        id,
        name: firstString(entry.name, entry.title) ?? '迁移模板',
        framework,
        kind,
        frontMatter,
        version: positiveInteger(entry.version) ?? 1,
        builtin: false,
      });
      known.add(id);
      report.convertedTemplates.push(id);
    }
    if (report.convertedTemplates.length > 0) await writeLibrary(targetRoot, library);
  }

  private async convertLegacySnippets(value: unknown, targetRoot: string, report: MigrationReport): Promise<void> {
    const entries = legacyCollection(value, ['snippets', 'items']);
    if (entries.length === 0) return;
    const library = await readLibrary(targetRoot);
    const known = new Set(library.snippets.map((snippet) => snippet.id));
    for (const entry of entries) {
      const id = legacyId(firstString(entry.id, entry.snippetId), `legacy-snippet-${hashFile(JSON.stringify(entry)).slice(0, 16)}`);
      if (known.has(id)) continue;
      const body = firstString(entry.body, entry.content, entry.text) ?? '';
      if (!body && !firstString(entry.name, entry.title)) continue;
      library.snippets.push({
        id,
        name: firstString(entry.name, entry.title) ?? '迁移片段',
        body,
        tags: stringList(entry.tags ?? entry.categories),
        updatedAt: validDate(firstString(entry.updatedAt, entry.updated_at, entry.createdAt)) ?? new Date().toISOString(),
      });
      known.add(id);
      report.convertedSnippets.push(id);
    }
    if (report.convertedSnippets.length > 0) await writeLibrary(targetRoot, library);
  }

  private async convertLegacyStats(value: unknown, targetRoot: string, report: MigrationReport): Promise<void> {
    if (!isRecord(value)) return;
    if (this.libraryWasPresent) return;
    const library = await readLibrary(targetRoot);
    if (library.stats.totalWords !== 0 || library.stats.totalCharacters !== 0 || library.stats.articles !== 0) return;
    const totalWords = nonNegativeInteger(value.totalWords ?? value.words ?? value.wordCount);
    const totalCharacters = nonNegativeInteger(value.totalCharacters ?? value.characters ?? value.characterCount);
    const articles = nonNegativeInteger(value.articles ?? value.articleCount ?? value.posts);
    if (totalWords === undefined && totalCharacters === undefined && articles === undefined) return;
    library.stats = {
      totalWords: totalWords ?? 0,
      totalCharacters: totalCharacters ?? 0,
      articles: articles ?? 0,
      updatedAt: validDate(firstString(value.updatedAt, value.updated_at)) ?? new Date().toISOString(),
    };
    await writeLibrary(targetRoot, library);
    report.convertedStats.push('writing_stats.json');
  }

  private async convertLegacyRepositories(value: unknown, targetRoot: string, report: MigrationReport): Promise<void> {
    const entries = legacyCollection(value, ['repos', 'repositories', 'sites', 'items']);
    if (entries.length === 0) return;
    const registryPath = join(targetRoot, 'sites', 'registry.json');
    const existing = await readJson(registryPath);
    const sites = Array.isArray(existing?.sites) ? existing.sites as Json[] : [];
    const known = new Set(sites.map((site) => typeof site.id === 'string' ? site.id : ''));
    for (const entry of entries) {
      const id = legacyId(firstString(entry.id, entry.siteId, entry.repoId), `legacy-site-${hashFile(JSON.stringify(entry)).slice(0, 16)}`);
      if (known.has(id)) continue;
      const config = {
        provider: normalizeProvider(firstString(entry.provider, entry.platform, entry.host)),
        repository: firstString(entry.repository, entry.repo, entry.name) ?? id,
        branch: firstString(entry.branch, entry.defaultBranch) ?? 'main',
        postPath: firstString(entry.postPath, entry.postsPath, entry.articlePath) ?? 'posts',
        pagePath: firstString(entry.pagePath, entry.pagesPath) ?? 'pages',
        framework: normalizeFramework(firstString(entry.framework, entry.frameworkId)) ?? 'hexo',
        filenameRule: firstString(entry.filenameRule, entry.fileNameRule) === 'date-slug' ? 'date-slug' : 'slug',
        publishTimeZoneOffsetMinutes: Number.isSafeInteger(Number(entry.publishTimeZoneOffsetMinutes)) ? Number(entry.publishTimeZoneOffsetMinutes) : 480,
        mirrors: stringList(entry.mirrors),
        hooks: stringList(entry.hooks, entry.deployHook),
        url: firstString(entry.url, entry.siteUrl),
        apiBaseUrl: firstString(entry.apiBaseUrl, entry.endpoint),
        commitMessage: firstString(entry.commitMessage),
        ...(secretRef(entry.credentialRef ?? entry.tokenRef ?? entry.apiKeyRef) ? { credentialRef: secretRef(entry.credentialRef ?? entry.tokenRef ?? entry.apiKeyRef) } : {}),
      };
      const site = createStaticSite({
        id,
        kind: 'static',
        name: firstString(entry.name, entry.title, entry.repository) ?? id,
        isDefault: entry.isDefault === true || entry.default === true || sites.length === 0,
        url: config.url,
        config: {
          ...config,
          postPath: SafeRelativePath.parse(config.postPath),
          pagePath: SafeRelativePath.parse(config.pagePath),
        },
      });
      sites.push(serializeMigratedSite(site));
      known.add(id);
      report.convertedSites.push(id);
    }
    if (report.convertedSites.length === 0) return;
    const activeSiteId = typeof existing?.activeSiteId === 'string' && known.has(existing.activeSiteId)
      ? existing.activeSiteId
      : sites.find((site) => site.isDefault === true)?.id;
    await this.replaceAtomicWrite(registryPath, JSON.stringify({ schemaVersion: 1, activeSiteId, sites }, null, 2));
  }

  private async extractSecrets(value: unknown, report: MigrationReport, path = ''): Promise<{ publicData: unknown; refs: string[] }> {
    const refs: string[] = [];
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < value.length; index++) { const child = await this.extractSecrets(value[index], report, `${path}[${index}]`); result.push(child.publicData); refs.push(...child.refs); }
      return { publicData: result, refs };
    }
    if (!value || typeof value !== 'object') return { publicData: value, refs };
    const result: Json = {};
    for (const [key, childValue] of Object.entries(value as Json)) {
      if (secretKey.test(key) && typeof childValue === 'string' && childValue.length > 0) {
        const ref = makeSecretRef(key.toLowerCase().includes('password') ? 'password' : key.toLowerCase().includes('token') ? 'credential' : 'apiKey', `${path}.${key}`);
        await this.secrets.put(childValue, ref);
        result[`${key}Ref`] = ref;
        refs.push(ref.id);
      } else {
        const child = await this.extractSecrets(childValue, report, path ? `${path}.${key}` : key); result[key] = child.publicData; refs.push(...child.refs);
      }
    }
    return { publicData: result, refs };
  }

  private async atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
    if (await exists(path)) return;
    const tmp = `${path}.${process.pid}.tmp`;
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(tmp, data, { flag: 'wx' }).catch(async (error: any) => { if (error.code !== 'EEXIST') throw error; await fs.writeFile(tmp, data); });
    await fs.rename(tmp, path);
  }

  private async replaceAtomicWrite(path: string, data: string | Uint8Array): Promise<void> {
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(tmp, data, { flag: 'wx' });
    try {
      await fs.rename(tmp, path);
    } catch (error: any) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      await fs.rm(path, { force: true });
      await fs.rename(tmp, path);
    }
  }

  private async writeBackup(path: string, raw: Uint8Array, report: MigrationReport, sensitive: boolean): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    if (!sensitive) {
      await fs.writeFile(path, raw, { flag: 'wx' }).catch((error: any) => { if (error.code !== 'EEXIST') throw error; });
      if (hashFile(await fs.readFile(path)) !== hashFile(raw)) throw new DomainError('storage', 'Migration backup verification failed');
      try { await fs.chmod(path, 0o400); } catch { /* Windows may not expose POSIX modes. */ }
      report.backups.push(path);
      return;
    }
    if (!this.backupKey) {
      if (this.backupKeyRef) throw new DomainError('security', 'Existing migration backup key is unavailable');
      this.backupKey = randomBytes(32);
      this.backupKeyRef = makeSecretRef('encryptionKey', 'migration.backup-key');
      await this.secrets.put(Buffer.from(this.backupKey).toString('base64'), this.backupKeyRef);
      report.backupKeyRef = this.backupKeyRef;
      report.secretRefs.push(this.backupKeyRef.id);
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.backupKey, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(raw)), cipher.final()]);
    const encryptedPath = `${path}.enc.json`;
    await fs.writeFile(encryptedPath, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') }), { flag: 'wx' }).catch((error: any) => { if (error.code !== 'EEXIST') throw error; });
    if (!this.backupKeyRef || hashFile(await this.readBackup(encryptedPath, this.backupKeyRef)) !== hashFile(raw)) throw new DomainError('storage', 'Encrypted migration backup verification failed');
    try { await fs.chmod(encryptedPath, 0o400); } catch { /* Windows may not expose POSIX modes. */ }
    report.backups.push(encryptedPath);
  }
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(path);
    else if (entry.isFile()) total += (await fs.stat(path)).size;
  }
  return total;
}

function legacyDraftEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['drafts', 'articles', 'items']) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return Object.values(value).filter(isRecord).filter((item) => 'body' in item || 'content' in item || 'markdown' in item);
}

type MigratedLibrary = {
  schemaVersion: 1;
  templates: Array<{ id: string; name: string; framework: StaticFramework; kind: 'post' | 'page'; frontMatter: string; version: number; builtin: boolean }>;
  snippets: Array<{ id: string; name: string; body: string; tags: string[]; updatedAt: string }>;
  volumes: Array<{ id: string; name: string; articleIds: string[]; updatedAt: string }>;
  stats: { totalWords: number; totalCharacters: number; articles: number; updatedAt: string };
};

async function readLibrary(targetRoot: string): Promise<MigratedLibrary> {
  const value = await readJson(join(targetRoot, 'writing', 'library.json'));
  return {
    schemaVersion: 1,
    templates: Array.isArray(value?.templates) ? value.templates as MigratedLibrary['templates'] : [],
    snippets: Array.isArray(value?.snippets) ? value.snippets as MigratedLibrary['snippets'] : [],
    volumes: Array.isArray(value?.volumes) ? value.volumes as MigratedLibrary['volumes'] : [],
    stats: isRecord(value?.stats) ? {
      totalWords: nonNegativeInteger(value.stats.totalWords) ?? 0,
      totalCharacters: nonNegativeInteger(value.stats.totalCharacters) ?? 0,
      articles: nonNegativeInteger(value.stats.articles) ?? 0,
      updatedAt: validDate(firstString(value.stats.updatedAt)) ?? new Date().toISOString(),
    } : { totalWords: 0, totalCharacters: 0, articles: 0, updatedAt: new Date().toISOString() },
  };
}

async function writeLibrary(targetRoot: string, library: MigratedLibrary): Promise<void> {
  const path = join(targetRoot, 'writing', 'library.json');
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(library, null, 2), { flag: 'wx' });
  try { await fs.rename(temporary, path); } catch (error: any) {
    if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
    await fs.rm(path, { force: true });
    await fs.rename(temporary, path);
  }
}

function legacyCollection(value: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key].filter(isRecord);
  return Object.values(value).filter(isRecord);
}

function legacyId(value: string | undefined, fallback: string): string {
  return value && /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : fallback;
}

function normalizeFramework(value: string | undefined): StaticFramework | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replaceAll('.', '').replaceAll('-', '');
  return frameworks.find((framework) => framework.replaceAll('-', '') === normalized || framework === value) ?? undefined;
}

function normalizeProvider(value: string | undefined): 'github' | 'gitlab' | 'gitee' | 'bitbucket' | 'generic' {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.includes('gitlab')) return 'gitlab';
  if (normalized.includes('gitee')) return 'gitee';
  if (normalized.includes('bitbucket')) return 'bitbucket';
  if (normalized.includes('github')) return 'github';
  return 'generic';
}

function serializeMigratedSite(site: ReturnType<typeof createStaticSite>): Json {
  return { ...site, config: { ...site.config, postPath: site.config.postPath.value, pagePath: site.config.pagePath.value } };
}

function secretRef(value: unknown): SecretRef | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string' || typeof value.label !== 'string') return undefined;
  return { id: value.id, kind: value.kind as SecretRef['kind'], label: value.label };
}

function legacyDraftToArticle(value: Record<string, unknown>, known: Set<string>): Article | undefined {
  const body = firstString(value.body, value.content, value.markdown) ?? '';
  if (!body && !firstString(value.title, value.name)) return undefined;
  const metadataValue = isRecord(value.metadata) ? value.metadata : value;
  const tags = stringList(metadataValue.tags ?? value.tags);
  const categories = stringList(metadataValue.categories ?? value.categories ?? metadataValue.category);
  const kind = metadataValue.kind === 'page' || value.type === 'page' ? 'page' : 'post';
  const metadata: ArticleMetadata = {
    tags,
    categories,
    kind,
    cover: firstString(metadataValue.cover, value.cover),
    templateId: firstString(metadataValue.templateId, value.templateId),
    slug: firstString(metadataValue.slug, value.slug),
    extraFrontMatter: isRecord(metadataValue.extraFrontMatter)
      ? structuredClone(metadataValue.extraFrontMatter)
      : isRecord(value.frontMatter)
          ? structuredClone(value.frontMatter)
          : {},
  };
  const requestedId = firstString(value.id, value.articleId);
  const fallbackId = `legacy-${hashFile(JSON.stringify(value)).slice(0, 16)}`;
  if (requestedId && /^[a-zA-Z0-9_-]{1,100}$/.test(requestedId) && known.has(requestedId)) return undefined;
  const id = requestedId && /^[a-zA-Z0-9_-]{1,100}$/.test(requestedId)
    ? requestedId
    : fallbackId;
  if (known.has(id)) return undefined;
  const createdAt = validDate(firstString(value.createdAt, value.created_at));
  const updatedAt = validDate(firstString(value.updatedAt, value.updated_at)) ?? createdAt;
  const article = createArticle({
    id,
    title: firstString(value.title, value.name) ?? '未命名文章',
    body,
    metadata,
    createdAt,
    updatedAt,
    volume: firstString(value.volume, value.notebook),
    scheduleAt: validDate(firstString(value.scheduleAt, value.publishAt, value.scheduledAt)),
    published: value.published === true || value.status === 'published',
  });
  const revision = Number(value.localRevision ?? value.revision);
  if (Number.isSafeInteger(revision) && revision >= 1) article.localRevision = revision;
  return article;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function validDate(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function stringList(...inputs: unknown[]): string[] {
  const values = inputs.flatMap((value) => Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : []);
  return [...new Set(values.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}
