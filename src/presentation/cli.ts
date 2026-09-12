import { promises as fs, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createArticle } from '../domain/article.ts';
import { JsonArticleRepository } from '../infrastructure/json-article-repository.ts';
import { JsonlAuditStore } from '../infrastructure/audit.ts';
import { SaveDraftUseCase } from '../application/save-draft.ts';
import { startWebServer } from './web/server.ts';
import { JsonSiteRegistry } from '../infrastructure/json-site-registry.ts';
import { JsonWritingLibraryStore } from '../infrastructure/json-writing-library.ts';
import { SiteHealthMonitor } from '../application/sites.ts';
import { createHttpSiteCheck } from '../infrastructure/site-health.ts';
import { JsonBindingStore } from '../infrastructure/json-binding-store.ts';
import { createEnvironmentCmsGateway, createEnvironmentStaticGateway } from '../infrastructure/runtime-gateways.ts';
import { createEnvironmentBatchUpload, createEnvironmentImageHost, createEnvironmentRemoteArticleQuery } from '../infrastructure/runtime-gateways.ts';
import { createEnvironmentProvisioningGateway } from '../infrastructure/runtime-gateways.ts';
import { RemoteArticleRollbackUseCase } from '../application/remote-articles.ts';
import { CmsPublishUseCase, StaticPublishUseCase } from '../application/publish.ts';
import { SiteProvisioningUseCase } from '../application/provisioning.ts';
import { HttpPublishSideEffects } from '../infrastructure/publish-side-effects.ts';
import { ImageHostUseCase, RssFeedService } from '../application/content-tools.ts';
import { HttpJsonClient } from '../application/http-client.ts';
import { BUILTIN_PROVIDERS, ProtocolLlmAdapter } from '../application/llm.ts';
import type { ModelCandidate } from '../application/ai.ts';
import { QuickWritingUseCase } from '../application/quick-actions.ts';
import { DomainError } from '../domain/errors.ts';
import { publicHttpUrl } from '../infrastructure/http-safety.ts';
import type { StaticSite } from '../domain/site.ts';
import type { GatewayRequestOptions } from '../application/ports.ts';
import { JsonCacheStore } from '../infrastructure/cache-store.ts';
import { JsonSettingsStore } from '../infrastructure/settings-store.ts';
import { createSettingsAwareFetch } from '../infrastructure/proxy-fetch.ts';
import { FrameworkRenderer } from '../domain/renderer.ts';
import { EncryptedFileSecretStore } from '../infrastructure/secret-store.ts';
import { LegacyMigrationUseCase } from '../application/migration.ts';

function option(args: string[], name: string, fallback?: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }
function migrationKey(): Uint8Array { const encoded = process.env.TUOMO_MIGRATION_KEY; if (!encoded) throw new DomainError('security', 'migrate requires TUOMO_MIGRATION_KEY as base64 32-byte key'); const key = Buffer.from(encoded, 'base64'); if (key.byteLength !== 32) throw new DomainError('security', 'TUOMO_MIGRATION_KEY must decode to 32 bytes'); return key; }
function help(): void { console.log('拓墨 CLI\n\n  init --root <dir>\n  doctor --root <dir>\n  migrate --from <legacy-dir> --root <dir>\n  create --root <dir> --title <title> --body <markdown>\n  list --root <dir> [--text <query>]\n  serve --root <dir> [--port <port>]'); }

const args = process.argv.slice(2); const command = args[0]; const root = resolve(option(args, '--root', '.tuomo')!);
const repo = new JsonArticleRepository(root); const audit = new JsonlAuditStore(resolve(root, 'logs', 'audit.jsonl')); const save = new SaveDraftUseCase(repo, audit);
const sites = new JsonSiteRegistry(resolve(root, 'sites', 'registry.json'));
const writingLibrary = new JsonWritingLibraryStore(resolve(root, 'writing', 'library.json'));
const templateCache = new Map<string, { framework: string; frontMatter: string }>();
const renderer = new FrameworkRenderer(undefined, (templateId, site) => {
  let template = templateCache.get(templateId);
  try {
    const file = JSON.parse(readFileSync(resolve(root, 'writing', 'library.json'), 'utf8')) as { templates?: Array<{ id: string; framework: string; frontMatter: string }> };
    template = file.templates?.find((value) => value.id === templateId);
  } catch {
    // The cache keeps publishing usable while the library is first created.
  }
  return template?.framework === site.config.framework ? template.frontMatter : undefined;
});
const bindings = new JsonBindingStore(resolve(root, 'sites', 'bindings.json'));
const cacheStore = new JsonCacheStore(resolve(root, 'cache', 'entries.json'));
const settingsStore = new JsonSettingsStore(resolve(root, 'settings', 'public.json'));
const runtimeFetch = createSettingsAwareFetch(settingsStore);
const staticGateway = createEnvironmentStaticGateway(runtimeFetch);
const remoteArticleQuery = createEnvironmentRemoteArticleQuery(runtimeFetch);
const remoteArticleRollback = new RemoteArticleRollbackUseCase(remoteArticleQuery, staticGateway, audit);
const sideEffects = new HttpPublishSideEffects(runtimeFetch);
const staticPublisher = new StaticPublishUseCase(repo, staticGateway, renderer, bindings, audit, sideEffects);
const cmsPublisher = new CmsPublishUseCase(repo, createEnvironmentCmsGateway(runtimeFetch), bindings, audit);
const runtimeHttp = new HttpJsonClient(runtimeFetch);
const aiProvider = process.env.TUOMO_AI_PROVIDER ?? 'openai';
const aiDefaults = BUILTIN_PROVIDERS[aiProvider] ?? { id: aiProvider, protocol: (process.env.TUOMO_AI_PROTOCOL ?? 'openai-chat') as 'openai-chat' | 'openai-responses' | 'anthropic', endpoint: '', headers: {} };
const aiKey = process.env.TUOMO_SECRET_AI;
const aiEndpoint = process.env.TUOMO_AI_ENDPOINT ?? aiDefaults?.endpoint;
const aiModel = aiEndpoint ? { id: process.env.TUOMO_AI_MODEL ?? aiProvider, group: 'default', priority: 0, healthy: true, failures: 0, contextLimit: Number(process.env.TUOMO_AI_CONTEXT_LIMIT ?? 8_192) } satisfies ModelCandidate : undefined;
const quickWriting = aiKey && aiEndpoint ? new QuickWritingUseCase(new ProtocolLlmAdapter({ ...aiDefaults, endpoint: aiEndpoint, apiKey: aiKey, model: aiModel?.id ?? aiProvider }, runtimeFetch)) : undefined;
const rssFeed = new RssFeedService(async (url, options) => (await runtimeHttp.requestText(url, {}, options)).body);
const linkProbe = async (url: string, signal?: AbortSignal) => {
  try {
    const response = await runtimeHttp.requestText(publicHttpUrl(url), { method: 'HEAD' }, { signal, retries: 1 });
    return { ok: response.status >= 200 && response.status < 400, status: response.status };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, status: typeof error.details.status === 'number' ? error.details.status : undefined };
    throw error;
  }
};
const imageHostFactory = (site: Parameters<typeof createEnvironmentImageHost>[0]) => new ImageHostUseCase(createEnvironmentImageHost(site, runtimeFetch));
const batchUploadFactory = (site: Parameters<typeof createEnvironmentBatchUpload>[0]) => createEnvironmentBatchUpload(site, runtimeFetch);
const provisioning = new SiteProvisioningUseCase(createEnvironmentProvisioningGateway(runtimeFetch), audit, sites);
const buildTrigger = async (site: StaticSite, options?: GatewayRequestOptions) => {
  let triggered = 0;
  for (const hook of site.config.hooks) { await sideEffects.triggerHook(site, hook, options); triggered++; }
  return { triggered };
};

try {
  if (command === 'init') { await repo.init(); await sites.init(); await writingLibrary.read(); await fs.mkdir(resolve(root, 'meta'), { recursive: true }); await fs.writeFile(resolve(root, 'meta', 'schema.json'), JSON.stringify({ schemaVersion: 1 }, null, 2), { flag: 'wx' }).catch(() => undefined); console.log(`已初始化 ${root}`); }
  else if (command === 'doctor') { await repo.init(); await sites.init(); const library = await writingLibrary.read(); const articles = await repo.list(); console.log(JSON.stringify({ root, schema: 1, articleCount: articles.length, siteCount: sites.list().length, activeSiteId: sites.active()?.id, templateCount: library.templates.length, snippetCount: library.snippets.length, volumeCount: library.volumes.length, status: 'ok' }, null, 2)); }
  else if (command === 'migrate') { const sourceValue = option(args, '--from'); if (!sourceValue) throw new DomainError('validation', 'migrate requires --from <legacy-dir>'); const source = resolve(sourceValue); const normalizedSource = process.platform === 'win32' ? source.toLowerCase() : source; const normalizedTarget = process.platform === 'win32' ? root.toLowerCase() : root; if (normalizedSource === normalizedTarget) throw new DomainError('validation', 'Legacy source and target roots must be different'); const secrets = new EncryptedFileSecretStore(resolve(root, 'secrets', 'vault.json'), migrationKey()); const report = await new LegacyMigrationUseCase(secrets, audit).execute(source, root); console.log(JSON.stringify({ root, source, ...report }, null, 2)); }
  else if (command === 'create') { const title = option(args, '--title', '未命名文章')!; const body = option(args, '--body', '')!; const article = createArticle({ title, body }); const result = await save.execute(article); if (result.state !== 'saved') throw result.error; console.log(JSON.stringify({ id: article.id, revision: article.localRevision, state: result.state }, null, 2)); }
  else if (command === 'list') { console.log(JSON.stringify(await repo.list({ text: option(args, '--text') }), null, 2)); }
  else if (command === 'serve') { await repo.init(); await sites.init(); const library = await writingLibrary.read(); templateCache.clear(); for (const template of library.templates) templateCache.set(template.id, { framework: template.framework, frontMatter: template.frontMatter }); const port = Number(option(args, '--port', '3210')); const healthMonitor = new SiteHealthMonitor(sites, createHttpSiteCheck(runtimeFetch)); startWebServer(repo, port, save, { siteRegistry: sites, healthMonitor, writingLibrary, staticPublisher, cmsPublisher, remoteArticleQuery, remoteArticleRollback, rssFeed, linkProbe, imageHostFactory, batchUploadFactory, provisioning, buildTrigger, quickWriting, aiModel, cacheStore, settingsStore }); console.log(`Web UI: http://localhost:${port}`); }
  else help();
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
