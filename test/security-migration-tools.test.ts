import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LegacyMigrationUseCase } from '../src/application/migration.ts';
import { ToolExecutor, ToolRegistry } from '../src/domain/tools.ts';
import { MemorySecretStore } from '../src/infrastructure/secret-store.ts';
import { JsonlAuditStore } from '../src/infrastructure/audit.ts';
import { decryptDraft, encryptDraft } from '../src/application/draft-encryption.ts';

test('legacy migration backs up files and extracts secrets into refs', async () => {
  const legacy = await mkdtemp(join(tmpdir(), 'legacy-')); const target = await mkdtemp(join(tmpdir(), 'target-'));
  await writeFile(join(legacy, 'settings.json'), JSON.stringify({ theme: 'dark', token: 'do-not-write-me', nested: { password: 'also-secret' } }));
  await writeFile(join(legacy, 'drafts.json.enc'), 'legacy-encrypted-envelope');
  await mkdir(join(legacy, 'sites')); await writeFile(join(legacy, 'sites', 'site.json'), JSON.stringify({ name: 'site', apiKey: 'site-secret' }));
  const store = new MemorySecretStore(); const report = await new LegacyMigrationUseCase(store).execute(legacy, target);
  const publicData = await readFile(join(target, 'settings', 'public.json'), 'utf8');
  assert.equal(report.secretRefs.length, 4); assert.doesNotMatch(publicData, /do-not-write-me|also-secret/); assert.equal(await store.get(JSON.parse(publicData).tokenRef), 'do-not-write-me'); assert.doesNotMatch(await readFile(join(target, 'sites', 'site.json'), 'utf8'), /site-secret/); assert.equal(await readFile(join(target, 'legacy-import', 'drafts.json.enc'), 'utf8'), 'legacy-encrypted-envelope');
});

test('migration stores device keys as references and encrypts sensitive backups', async () => {
  const legacy = await mkdtemp(join(tmpdir(), 'legacy-device-')); const target = await mkdtemp(join(tmpdir(), 'target-device-'));
  await writeFile(join(legacy, '.device_key'), 'device-secret');
  await writeFile(join(legacy, 'settings.json'), JSON.stringify({ token: 'migration-secret' }));
  const store = new MemorySecretStore();
  const report = await new LegacyMigrationUseCase(store).execute(legacy, target);
  const refFile = await readFile(join(target, 'legacy-import', '.device_key.ref.json'), 'utf8');
  assert.doesNotMatch(refFile, /device-secret/);
  assert.ok(report.backupKeyRef);
  assert.ok(await store.get(report.backupKeyRef!));
  for (const backup of report.backups) assert.doesNotMatch(await readFile(backup, 'utf8'), /device-secret|migration-secret/);
  const deviceBackup = report.backups.find((path) => path.endsWith('.device_key.enc.json'))!;
  assert.equal(Buffer.from(await new LegacyMigrationUseCase(store).readBackup(deviceBackup, report.backupKeyRef!), 'utf8').toString(), 'device-secret');
});

test('legacy drafts are converted to canonical articles without overwriting existing data', async () => {
  const legacy = await mkdtemp(join(tmpdir(), 'legacy-drafts-'));
  const target = await mkdtemp(join(tmpdir(), 'target-drafts-'));
  await writeFile(join(legacy, 'drafts.json'), JSON.stringify({
    drafts: [
      { id: 'legacy-one', title: '旧文章', content: '# 正文', tags: ['旧', '旧'], categories: '迁移', revision: 3 },
      { id: '../unsafe', title: '安全 ID 回退', body: '保留正文' },
    ],
  }));
  const report = await new LegacyMigrationUseCase(new MemorySecretStore()).execute(legacy, target);
  assert.equal(report.convertedArticles.length, 2);
  const index = JSON.parse(await readFile(join(target, 'articles', 'index.json'), 'utf8')) as Array<{ id: string; title: string; localRevision: number }>;
  assert.equal(index.length, 2);
  assert.deepEqual(index[0], { id: 'legacy-one', title: '旧文章', updatedAt: index[0].updatedAt, localRevision: 3, published: false, metadata: index[0].metadata });
  assert.match(index[1].id, /^[a-zA-Z0-9_-]+$/);
  assert.equal(JSON.parse(await readFile(join(target, 'articles', 'legacy-one.json'), 'utf8')).body, '# 正文');
  assert.equal(JSON.parse(await readFile(join(target, 'legacy-import', 'drafts.json'), 'utf8')).drafts.length, 2);
  const second = await new LegacyMigrationUseCase(new MemorySecretStore()).execute(legacy, target);
  assert.equal(second.convertedArticles.length, 0);
  assert.equal((JSON.parse(await readFile(join(target, 'articles', 'index.json'), 'utf8')) as unknown[]).length, 2);
});

test('legacy writing assets and repositories are converted into canonical stores', async () => {
  const legacy = await mkdtemp(join(tmpdir(), 'legacy-assets-'));
  const target = await mkdtemp(join(tmpdir(), 'target-assets-'));
  await writeFile(join(legacy, 'templates.json'), JSON.stringify({ templates: [{ id: 'old-template', name: '旧模板', framework: 'hugo', kind: 'post', frontMatter: '---\ntitle: {{title}}\n---' }] }));
  await writeFile(join(legacy, 'snippets.json'), JSON.stringify([{ id: 'old-snippet', name: '旧片段', body: '**正文**', tags: ['写作'] }]));
  await writeFile(join(legacy, 'writing_stats.json'), JSON.stringify({ words: 8, characters: 20, articleCount: 2 }));
  await writeFile(join(legacy, 'repos.json'), JSON.stringify([{ id: 'old-site', name: '旧站点', provider: 'github', repository: 'owner/repo', framework: 'hugo', token: 'site-token' }]));
  const store = new MemorySecretStore();
  const first = await new LegacyMigrationUseCase(store).execute(legacy, target);
  assert.deepEqual(first.convertedTemplates, ['old-template']);
  assert.deepEqual(first.convertedSnippets, ['old-snippet']);
  assert.deepEqual(first.convertedStats, ['writing_stats.json']);
  assert.deepEqual(first.convertedSites, ['old-site']);
  const library = JSON.parse(await readFile(join(target, 'writing', 'library.json'), 'utf8')) as { templates: unknown[]; snippets: unknown[]; stats: { totalWords: number } };
  assert.equal(library.templates.length, 1);
  assert.equal(library.snippets.length, 1);
  assert.equal(library.stats.totalWords, 8);
  const registry = JSON.parse(await readFile(join(target, 'sites', 'registry.json'), 'utf8')) as { sites: Array<{ config: { credentialRef?: { id: string } } }> };
  assert.ok(registry.sites[0].config.credentialRef?.id);
  assert.equal(await store.get(registry.sites[0].config.credentialRef!), 'site-token');
  const second = await new LegacyMigrationUseCase(store).execute(legacy, target);
  assert.equal(second.convertedTemplates.length, 0);
  assert.equal(second.convertedSnippets.length, 0);
  assert.equal(second.convertedStats.length, 0);
  assert.equal(second.convertedSites.length, 0);
});

test('audit redacts credentials and tool policy requires authorization for writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-')); const audit = new JsonlAuditStore(join(root, 'audit.jsonl')); await audit.append({ action: 'x', details: { token: 'secret', authorization: 'Bearer abc' } }); const logged = await readFile(join(root, 'audit.jsonl'), 'utf8'); assert.doesNotMatch(logged, /secret|abc/);
  const registry = new ToolRegistry(); registry.register({ id: 'write', kind: 'repo', scope: 'global', params: {}, risk: 'external-write', enabled: true });
  const executor = new ToolExecutor(registry); await assert.rejects(() => executor.execute({ toolId: 'write', input: {}, sessionId: 's' }, () => 'nope'), /authorization required/);
  const allowed = new ToolExecutor(registry, () => true); assert.equal(await allowed.execute({ toolId: 'write', input: {}, sessionId: 's' }, () => 'ok'), 'ok');
});

test('tool schemas reject unknown parameters and redact handler failures', async () => {
  const registry = new ToolRegistry();
  registry.register({ id: 'safe.read', kind: 'file', scope: 'global', params: { path: 'safe-path' }, risk: 'read', enabled: true });
  const executor = new ToolExecutor(registry, () => true);
  await assert.rejects(() => executor.execute({ toolId: 'safe.read', input: { path: 'ok.md', token: 'secret' }, sessionId: 's' }, () => 'never'), /Unknown tool parameter/);
  await assert.rejects(() => executor.execute({ toolId: 'safe.read', input: { path: 'ok.md' }, sessionId: 's' }, () => { throw new Error('authorization=secret Bearer abc'); }), /authorization=secret/);
  assert.doesNotMatch(executor.audits.at(-1)?.error ?? '', /secret|abc/);
});

test('draft encryption uses PBKDF2 plus AES-256-GCM and rejects wrong passwords', () => {
  const envelope = encryptDraft('private draft', 'correct horse'); assert.equal(decryptDraft(envelope, 'correct horse'), 'private draft'); assert.throws(() => decryptDraft(envelope, 'wrong'), /incorrect/); assert.doesNotMatch(JSON.stringify(envelope), /private draft/);
});
