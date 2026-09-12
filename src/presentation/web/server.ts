import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createArticle, updateArticle } from '../../domain/article.ts';
import type { Article } from '../../domain/article.ts';
import { createCmsSite, createStaticSite } from '../../domain/site.ts';
import type { CmsSite, Site, StaticSite } from '../../domain/site.ts';
import { makeSecretRef, SafeRelativePath } from '../../domain/values.ts';
import type { SecretRef } from '../../domain/values.ts';
import { DomainError } from '../../domain/errors.ts';
import { visibleFeatures } from '../../domain/navigation.ts';
import { JsonArticleRepository } from '../../infrastructure/json-article-repository.ts';
import { SaveDraftUseCase } from '../../application/save-draft.ts';
import type { CmsPublishUseCase, StaticPublishUseCase } from '../../application/publish.ts';
import type { SiteHealthMonitor } from '../../application/sites.ts';
import type { SiteRegistry } from '../../application/ports.ts';
import { exportArticle } from '../../application/export.ts';
import type { ExportFormat } from '../../application/export.ts';
import { importArticle } from '../../application/import.ts';
import { BatchUploadUseCase, checkLinksDetailed, findAndReplace, formatMarkdown, ImageHostUseCase, markdownToHtml, RssFeedService, tableOfContents } from '../../application/content-tools.ts';
import type { ImportFormat } from '../../application/import.ts';
import type { HttpRemoteArticleQuery, RemoteArticleRollbackUseCase } from '../../application/remote-articles.ts';
import { renderWebApp } from './page.ts';
import type { WritingLibraryRepository } from '../../application/writing-library.ts';
import type { SiteProvisioningUseCase, ProvisionRequest } from '../../application/provisioning.ts';
import type { QuickAction, QuickWritingUseCase } from '../../application/quick-actions.ts';
import type { ModelCandidate } from '../../application/ai.ts';
import { publicHttpUrl } from '../../infrastructure/http-safety.ts';
import type { GatewayRequestOptions } from '../../application/ports.ts';
import type { JsonCacheStore } from '../../infrastructure/cache-store.ts';
import type { JsonSettingsStore } from '../../infrastructure/settings-store.ts';

type ArticlePatchInput = Partial<Pick<Article, 'title' | 'body' | 'volume' | 'scheduleAt' | 'published' | 'metadata'>> & { expectedRevision?: number };
type MutableSiteRegistry = SiteRegistry & {
  add(site: Site): Promise<void> | void;
  update(site: Site): Promise<void> | void;
  remove(id: string): Promise<void> | void;
  switchTo(id: string): Promise<Site> | Site;
};
export type WebServerOptions = {
  siteRegistry?: MutableSiteRegistry;
  healthMonitor?: SiteHealthMonitor;
  staticPublisher?: StaticPublishUseCase;
  cmsPublisher?: CmsPublishUseCase;
  writingLibrary?: WritingLibraryRepository;
  remoteArticleQuery?: HttpRemoteArticleQuery;
  remoteArticleRollback?: RemoteArticleRollbackUseCase;
  rssFeed?: RssFeedService;
  linkProbe?: (url: string, signal?: AbortSignal) => Promise<{ ok: boolean; status?: number }>;
  imageHostFactory?: (site: StaticSite) => ImageHostUseCase;
  batchUploadFactory?: (site: StaticSite) => BatchUploadUseCase;
  provisioning?: SiteProvisioningUseCase;
  buildTrigger?: (site: StaticSite, options?: GatewayRequestOptions) => Promise<{ triggered: number }>;
  quickWriting?: QuickWritingUseCase;
  aiModel?: ModelCandidate;
  cacheStore?: JsonCacheStore;
  settingsStore?: JsonSettingsStore;
};

async function body(request: IncomingMessage, maxLength = 1_000_000): Promise<string> {
  let result = '';
  for await (const chunk of request) {
    result += chunk.toString();
    if (result.length > maxLength) throw new DomainError('validation', 'Request too large');
  }
  return result;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function idFrom(pathname: string): string | undefined {
  const match = /^\/api\/articles\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function trashIdFrom(pathname: string, action: 'restore' | 'delete'): string | undefined {
  const match = new RegExp(`^/api/trash/([^/]+)/${action}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function snapshotPathFrom(pathname: string): { id: string; revision?: number; action?: 'restore' } | undefined {
  const match = /^\/api\/articles\/([^/]+)\/snapshots(?:\/(\d+)(?:\/(restore))?)?$/.exec(pathname);
  if (!match) return undefined;
  return { id: decodeURIComponent(match[1]), revision: match[2] ? Number(match[2]) : undefined, action: match[3] as 'restore' | undefined };
}

function sitePathFrom(pathname: string): { id?: string; action?: 'active' | 'health' | 'build' } | undefined {
  const match = /^\/api\/sites(?:\/([^/]+)(?:\/(active|health|build))?)?$/.exec(pathname);
  if (!match) return undefined;
  return { id: match[1] ? decodeURIComponent(match[1]) : undefined, action: match[2] as 'active' | 'health' | 'build' | undefined };
}

function publishPathFrom(pathname: string): { id: string; action: 'preview' | 'publish' } | undefined {
  const match = /^\/api\/articles\/([^/]+)\/publish\/(preview|confirm)$/.exec(pathname);
  if (!match) return undefined;
  return { id: decodeURIComponent(match[1]), action: match[2] === 'preview' ? 'preview' : 'publish' };
}

function remoteArticlePathFrom(pathname: string): { siteId: string; action: 'list' | 'content' | 'history' | 'rollback' } | undefined {
  const match = /^\/api\/sites\/([^/]+)\/remote-articles(?:\/(content|history|rollback))?$/.exec(pathname);
  if (!match) return undefined;
  return { siteId: decodeURIComponent(match[1]), action: (match[2] ?? 'list') as 'list' | 'content' | 'history' | 'rollback' };
}

function parseSite(input: Record<string, any>, id?: string): Site {
  assertPublicConfig(input.config ?? {});
  if (input.kind === 'static') {
    const config = input.config ?? {};
    return createStaticSite({
      id: id ?? input.id,
      name: String(input.name ?? ''),
      kind: 'static',
      isDefault: input.isDefault === true,
      url: input.url,
      config: {
        provider: config.provider,
        repository: String(config.repository ?? ''),
        branch: String(config.branch ?? ''),
        postPath: SafeRelativePath.parse(String(config.postPath ?? 'posts')),
        pagePath: SafeRelativePath.parse(String(config.pagePath ?? 'pages')),
        framework: config.framework,
        filenameRule: config.filenameRule,
        publishTimeZoneOffsetMinutes: Number(config.publishTimeZoneOffsetMinutes ?? 480),
        defaultTemplateId: config.defaultTemplateId,
        credentialRef: parseSecretRef(config.credentialRef, 'static credential'),
        mirrors: Array.isArray(config.mirrors) ? config.mirrors.map(String) : [],
        hooks: Array.isArray(config.hooks) ? config.hooks.map(String) : [],
        apiBaseUrl: config.apiBaseUrl,
        commitMessage: config.commitMessage,
      },
    });
  }
  if (input.kind === 'cms') {
    const config = input.config ?? {};
    return createCmsSite({
      id: id ?? input.id,
      name: String(input.name ?? ''),
      kind: 'cms',
      isDefault: input.isDefault === true,
      url: input.url,
      config: {
        cmsKind: config.cmsKind,
        baseUrl: String(config.baseUrl ?? ''),
        authRef: parseSecretRef(config.authRef, 'CMS authentication'),
        ignoreSsl: config.ignoreSsl === true,
        adapterOptions: config.adapterOptions ?? {},
      },
    });
  }
  throw new DomainError('validation', 'Site kind must be static or cms');
}

function parseSecretRef(value: unknown, label: string): SecretRef | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('security', `${label} must be a SecretRef object`);
  }
  const candidate = value as Record<string, unknown>;
  const kinds = ['credential', 'apiKey', 'password', 'header', 'encryptionKey'] as const;
  if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string' || typeof candidate.kind !== 'string' || !kinds.includes(candidate.kind as typeof kinds[number])) {
    throw new DomainError('security', `${label} is malformed`);
  }
  return makeSecretRef(candidate.kind as SecretRef['kind'], candidate.label, candidate.id);
}

function assertPublicConfig(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertPublicConfig);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(token|password|passwd|secret|api[-_]?key|authorization|cookie)/i.test(key) && typeof child === 'string' && child.length > 0) {
      throw new DomainError('security', `Secret values must use SecretRef: ${key}`);
    }
    assertPublicConfig(child);
  }
}

function selectSites(registry: SiteRegistry, ids: unknown, kind: Site['kind']): Array<Extract<Site, { kind: typeof kind }>> {
  if (!Array.isArray(ids) || ids.length === 0) throw new DomainError('validation', 'siteIds must be a non-empty array');
  return ids.map((value) => {
    const site = registry.get(String(value));
    if (!site) throw new DomainError('notFound', `Site not found: ${String(value)}`);
    if (site.kind !== kind) throw new DomainError('validation', `Site is not ${kind}: ${site.id}`);
    return site as Extract<Site, { kind: typeof kind }>;
  });
}

export function startWebServer(repository: JsonArticleRepository, port = 3210, save = new SaveDraftUseCase(repository), options: WebServerOptions = {}) {
  const server = createServer(async (request, response) => {
    const requestAbort = new AbortController();
    const abortRequest = () => requestAbort.abort();
    request.once('aborted', abortRequest);
    response.once('close', abortRequest);
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/articles') {
        json(response, 200, await repository.list({ text: url.searchParams.get('text') || undefined }));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/markdown/preview') {
        const input = JSON.parse(await body(request)) as { markdown?: unknown };
        if (typeof input.markdown !== 'string') throw new DomainError('validation', 'markdown is required');
        json(response, 200, { html: markdownToHtml(input.markdown), toc: tableOfContents(input.markdown) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/markdown/format') {
        const input = JSON.parse(await body(request)) as { markdown?: unknown };
        if (typeof input.markdown !== 'string') throw new DomainError('validation', 'markdown is required');
        json(response, 200, { markdown: formatMarkdown(input.markdown) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/markdown/replace') {
        const input = JSON.parse(await body(request)) as { markdown?: unknown; search?: unknown; replacement?: unknown; caseSensitive?: unknown; wholeWord?: unknown };
        if (typeof input.markdown !== 'string' || typeof input.search !== 'string' || typeof input.replacement !== 'string') {
          throw new DomainError('validation', 'markdown, search and replacement are required');
        }
        json(response, 200, { markdown: findAndReplace(input.markdown, input.search, input.replacement, { caseSensitive: input.caseSensitive === true, wholeWord: input.wholeWord === true }) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/ai/quick') {
        if (!options.quickWriting || !options.aiModel) throw new DomainError('unsupported', 'AI quick writing is not configured');
        const input = JSON.parse(await body(request)) as { action?: unknown; text?: unknown; instruction?: unknown };
        const actions: QuickAction[] = ['polish', 'continue', 'summary', 'outline', 'code', 'rewrite-selection'];
        if (typeof input.action !== 'string' || !actions.includes(input.action as QuickAction) || typeof input.text !== 'string' || !input.text.trim()) throw new DomainError('validation', 'action and non-empty text are required');
        const tokens: string[] = [];
        for await (const event of options.quickWriting.execute({ action: input.action as QuickAction, text: input.text, instruction: typeof input.instruction === 'string' ? input.instruction : undefined, model: options.aiModel, signal: requestAbort.signal })) if (event.type === 'token' && event.value) tokens.push(event.value);
        json(response, 200, { ok: true, text: tokens.join('') });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/tools/rss') {
        if (!options.rssFeed) throw new DomainError('unsupported', 'RSS gateway is not configured');
        const feedUrl = publicHttpUrl(url.searchParams.get('url'));
        json(response, 200, await options.rssFeed.refresh(feedUrl, { signal: requestAbort.signal }));
        return;
      }
      if (options.cacheStore && request.method === 'POST' && url.pathname === '/api/tools/cache/clear') {
        json(response, 200, { cleared: await options.cacheStore.clear() });
        return;
      }
      if (options.cacheStore && request.method === 'POST' && url.pathname === '/api/tools/cache/prune') {
        json(response, 200, { pruned: await options.cacheStore.prune() });
        return;
      }
      if (options.settingsStore && request.method === 'GET' && url.pathname === '/api/settings') {
        json(response, 200, await options.settingsStore.read() ?? { mode: 'simple', pinned: [], hidden: [], theme: 'system', editorTheme: 'default', nightMode: false, language: 'zh-CN', proxyUrl: '' });
        return;
      }
      if (options.settingsStore && request.method === 'PUT' && url.pathname === '/api/settings') {
        const value = JSON.parse(await body(request)) as any;
        await options.settingsStore.write(value);
        json(response, 200, value);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/tools/links') {
        if (!options.linkProbe) throw new DomainError('unsupported', 'Link checker is not configured');
        const input = JSON.parse(await body(request)) as { markdown?: unknown };
        if (typeof input.markdown !== 'string') throw new DomainError('validation', 'markdown is required');
        const safeProbe = (value: string, signal?: AbortSignal) => options.linkProbe!(publicHttpUrl(value), signal);
        json(response, 200, await checkLinksDetailed(input.markdown, safeProbe, { signal: requestAbort.signal, concurrency: 4 }));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/tools/image') {
        if (!options.siteRegistry || !options.imageHostFactory) throw new DomainError('unsupported', 'Image host gateway is not configured');
        const input = JSON.parse(await body(request, 16_000_000)) as { siteId?: unknown; filename?: unknown; mimeType?: unknown; bytesBase64?: unknown };
        if (typeof input.filename !== 'string' || typeof input.mimeType !== 'string' || typeof input.bytesBase64 !== 'string' || input.bytesBase64.length > 12_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bytesBase64)) throw new DomainError('validation', 'filename, mimeType and valid bytesBase64 are required');
        const site = options.siteRegistry.get(String(input.siteId ?? options.siteRegistry.active()?.id ?? ''));
        if (!site) throw new DomainError('notFound', 'Image host site was not found');
        if (site.kind !== 'static') throw new DomainError('validation', 'Image host requires a static site');
        const result = await options.imageHostFactory(site).execute(new Uint8Array(Buffer.from(input.bytesBase64, 'base64')), input.filename, input.mimeType, { signal: requestAbort.signal });
        json(response, 200, { ok: result.ok, result: result.result, error: result.error, retry: { filename: result.retry.filename, mimeType: result.retry.mimeType, bytesBase64: Buffer.from(result.retry.bytes).toString('base64') } });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/tools/batch-upload') {
        if (!options.siteRegistry || !options.batchUploadFactory) throw new DomainError('unsupported', 'Batch upload gateway is not configured');
        const input = JSON.parse(await body(request, 70_000_000)) as { siteId?: unknown; files?: unknown };
        const site = options.siteRegistry.get(String(input.siteId ?? options.siteRegistry.active()?.id ?? ''));
        if (!site) throw new DomainError('notFound', 'Batch upload site was not found');
        if (site.kind !== 'static') throw new DomainError('validation', 'Batch upload requires a static site');
        if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 500) throw new DomainError('validation', 'files must contain between 1 and 500 items');
        const files: Record<string, Uint8Array> = {}; let total = 0;
        for (const item of input.files as Array<{ path?: unknown; bytesBase64?: unknown }>) {
          if (typeof item?.path !== 'string' || typeof item.bytesBase64 !== 'string' || item.bytesBase64.length > 8_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.bytesBase64)) throw new DomainError('validation', 'Each file requires a safe path and valid bytesBase64');
          const bytes = new Uint8Array(Buffer.from(item.bytesBase64, 'base64')); total += bytes.byteLength;
          if (total > 50_000_000) throw new DomainError('validation', 'Batch upload is limited to 50 MB');
          files[item.path] = bytes;
        }
        json(response, 200, await options.batchUploadFactory(site).executeDetailed(files, { concurrency: 4, signal: requestAbort.signal }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/trash') {
        json(response, 200, await repository.listTrash());
        return;
      }
      if (options.writingLibrary && request.method === 'GET' && url.pathname === '/api/library') {
        json(response, 200, await options.writingLibrary.read());
        return;
      }
      if (options.writingLibrary && request.method === 'POST' && url.pathname === '/api/library/templates') {
        const input = JSON.parse(await body(request)) as any;
        json(response, 201, await options.writingLibrary.saveTemplate(input));
        return;
      }
      const templateMatch = /^\/api\/library\/templates\/([^/]+)$/.exec(url.pathname);
      if (options.writingLibrary && templateMatch && request.method === 'PUT') {
        const input = JSON.parse(await body(request)) as any;
        json(response, 200, await options.writingLibrary.saveTemplate({ ...input, id: decodeURIComponent(templateMatch[1]) }));
        return;
      }
      if (options.writingLibrary && templateMatch && request.method === 'DELETE') {
        await options.writingLibrary.removeTemplate(decodeURIComponent(templateMatch[1]));
        response.statusCode = 204;
        response.end();
        return;
      }
      if (options.writingLibrary && request.method === 'POST' && url.pathname === '/api/library/snippets') {
        json(response, 201, await options.writingLibrary.saveSnippet(JSON.parse(await body(request)) as any));
        return;
      }
      const snippetMatch = /^\/api\/library\/snippets\/([^/]+)$/.exec(url.pathname);
      if (options.writingLibrary && snippetMatch && request.method === 'DELETE') {
        await options.writingLibrary.removeSnippet(decodeURIComponent(snippetMatch[1]));
        response.statusCode = 204;
        response.end();
        return;
      }
      if (options.writingLibrary && request.method === 'POST' && url.pathname === '/api/library/volumes') {
        json(response, 201, await options.writingLibrary.saveVolume(JSON.parse(await body(request)) as any));
        return;
      }
      const volumeMatch = /^\/api\/library\/volumes\/([^/]+)$/.exec(url.pathname);
      if (options.writingLibrary && volumeMatch && request.method === 'PUT') {
        const input = JSON.parse(await body(request)) as any;
        json(response, 200, await options.writingLibrary.saveVolume({ ...input, id: decodeURIComponent(volumeMatch[1]) }));
        return;
      }
      if (options.writingLibrary && volumeMatch && request.method === 'DELETE') {
        await options.writingLibrary.removeVolume(decodeURIComponent(volumeMatch[1]));
        response.statusCode = 204;
        response.end();
        return;
      }
      const volumeArticleMatch = /^\/api\/library\/volumes\/([^/]+)\/articles\/([^/]+)$/.exec(url.pathname);
      if (options.writingLibrary && volumeArticleMatch && (request.method === 'POST' || request.method === 'DELETE')) {
        const volumeId = decodeURIComponent(volumeArticleMatch[1]);
        const articleId = decodeURIComponent(volumeArticleMatch[2]);
        const value = request.method === 'POST' ? await options.writingLibrary.addArticleToVolume(volumeId, articleId) : await options.writingLibrary.removeArticleFromVolume(volumeId, articleId);
        json(response, 200, value);
        return;
      }
      if (options.writingLibrary && request.method === 'POST' && url.pathname === '/api/library/stats/recompute') {
        const summaries = await repository.list();
        const articles = (await Promise.all(summaries.map((summary) => repository.get(summary.id)))).filter((article): article is Article => article !== undefined);
        json(response, 200, await options.writingLibrary.recomputeStats(articles));
        return;
      }
      const remoteArticlePath = remoteArticlePathFrom(url.pathname);
      if (remoteArticlePath) {
        if (!options.siteRegistry || !options.remoteArticleQuery) throw new DomainError('unsupported', 'Remote article gateway is not configured');
        const site = options.siteRegistry.get(remoteArticlePath.siteId);
        if (!site) throw new DomainError('notFound', `Site not found: ${remoteArticlePath.siteId}`);
        if (site.kind !== 'static') throw new DomainError('validation', 'Remote article browsing requires a static site');
        if (remoteArticlePath.action === 'list' && request.method === 'GET') {
          json(response, 200, await options.remoteArticleQuery.list(site, { text: url.searchParams.get('text') || undefined, prefix: url.searchParams.get('prefix') || undefined, limit: Number(url.searchParams.get('limit') ?? 200) }));
          return;
        }
        const path = url.searchParams.get('path');
        if (remoteArticlePath.action === 'content' && request.method === 'GET') {
          if (!path) throw new DomainError('validation', 'path is required');
          json(response, 200, await options.remoteArticleQuery.get(site, path, url.searchParams.get('revision') || site.config.branch, { signal: requestAbort.signal }));
          return;
        }
        if (remoteArticlePath.action === 'history' && request.method === 'GET') {
          if (!path) throw new DomainError('validation', 'path is required');
          const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 30)));
          json(response, 200, await options.remoteArticleQuery.history(site, path, limit, { signal: requestAbort.signal }));
          return;
        }
        if (remoteArticlePath.action === 'rollback' && request.method === 'POST') {
          if (!options.remoteArticleRollback) throw new DomainError('unsupported', 'Remote article rollback is not configured');
          const input = JSON.parse(await body(request)) as { path?: unknown; targetRevision?: unknown; expectedCurrentRevision?: unknown };
          if (typeof input.path !== 'string' || typeof input.targetRevision !== 'string' || typeof input.expectedCurrentRevision !== 'string') throw new DomainError('validation', 'path, targetRevision and expectedCurrentRevision are required');
          json(response, 200, await options.remoteArticleRollback.rollback(site, input.path, input.targetRevision, input.expectedCurrentRevision, { signal: requestAbort.signal }));
          return;
        }
        throw new DomainError('validation', 'Unsupported remote article operation');
      }
      if (request.method === 'POST' && url.pathname === '/api/sites/provision') {
        if (!options.provisioning) throw new DomainError('unsupported', 'Site provisioning gateway is not configured');
        const input = JSON.parse(await body(request)) as Partial<ProvisionRequest>;
        const frameworks = ['hexo', 'hugo', 'jekyll', 'vuepress', 'gatsby', 'nextjs', 'astro', 'pelican', '11ty'];
        if ((input.provider !== 'github' && input.provider !== 'gitlab') || typeof input.owner !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(input.owner) || typeof input.repository !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(input.repository) || typeof input.framework !== 'string' || !frameworks.includes(input.framework) || (input.mode !== 'pages' && input.mode !== 'cloudflare') || typeof input.welcomePost !== 'string') {
          throw new DomainError('validation', 'provider, owner, repository, framework, mode and welcomePost are required');
        }
        const provision: ProvisionRequest = { provider: input.provider, owner: input.owner, repository: input.repository, framework: input.framework, mode: input.mode, welcomePost: input.welcomePost, idempotencyKey: typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim() ? input.idempotencyKey : randomUUID() };
        json(response, 200, await options.provisioning.execute(provision, requestAbort.signal));
        return;
      }
      const sitePath = sitePathFrom(url.pathname);
      if (url.pathname === '/api/sites/health' && options.siteRegistry && options.healthMonitor && request.method === 'GET') {
        json(response, 200, await options.healthMonitor.checkAll(4, { signal: requestAbort.signal }));
        return;
      }
      if (sitePath && options.siteRegistry && request.method === 'GET' && sitePath.id === undefined) {
        json(response, 200, { activeSiteId: options.siteRegistry.active()?.id, sites: options.siteRegistry.list() });
        return;
      }
      if (sitePath && options.siteRegistry && request.method === 'POST' && sitePath.id === undefined) {
        const site = parseSite(JSON.parse(await body(request)) as Record<string, any>);
        await options.siteRegistry.add(site);
        json(response, 201, site);
        return;
      }
      if (sitePath && options.siteRegistry && options.healthMonitor && request.method === 'GET' && sitePath.action === 'health') {
        json(response, 200, await options.healthMonitor.checkOne(sitePath.id!, { signal: requestAbort.signal }));
        return;
      }
      if (sitePath && options.siteRegistry && options.buildTrigger && sitePath.id && sitePath.action === 'build' && request.method === 'POST') {
        const site = options.siteRegistry.get(sitePath.id);
        if (!site) throw new DomainError('notFound', `Site not found: ${sitePath.id}`);
        if (site.kind !== 'static') throw new DomainError('validation', 'Only static sites support build triggers');
        json(response, 200, await options.buildTrigger(site, { signal: requestAbort.signal }));
        return;
      }
      if (sitePath && options.siteRegistry && sitePath.id && sitePath.action === 'active' && request.method === 'POST') {
        json(response, 200, await options.siteRegistry.switchTo(sitePath.id));
        return;
      }
      if (sitePath && options.siteRegistry && sitePath.id && request.method === 'PUT') {
        const site = parseSite(JSON.parse(await body(request)) as Record<string, any>, sitePath.id);
        await options.siteRegistry.update(site);
        json(response, 200, site);
        return;
      }
      if (sitePath && options.siteRegistry && sitePath.id && request.method === 'DELETE') {
        await options.siteRegistry.remove(sitePath.id);
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/articles') {
        const input = JSON.parse(await body(request)) as Partial<Pick<Article, 'title' | 'body' | 'volume' | 'scheduleAt' | 'published' | 'metadata'>>;
        const article = createArticle({ title: input.title, body: input.body, volume: input.volume, scheduleAt: input.scheduleAt, published: input.published, metadata: input.metadata });
        const result = await save.execute(article);
        if (result.state !== 'saved') throw result.error ?? new DomainError('storage', 'Save failed');
        json(response, 201, article);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/import') {
        const input = JSON.parse(await body(request)) as { format?: ImportFormat; filename?: string; bytesBase64?: string };
        if (!input.format || !['markdown', 'html', 'docx'].includes(input.format) || !input.filename || !input.bytesBase64) {
          throw new DomainError('validation', 'format, filename and bytesBase64 are required');
        }
        const article = importArticle({ format: input.format, filename: input.filename, bytes: Buffer.from(input.bytesBase64, 'base64') });
        const result = await save.execute(article);
        if (result.state !== 'saved') throw result.error ?? new DomainError('storage', 'Import save failed');
        json(response, 201, article);
        return;
      }
      const publishPath = publishPathFrom(url.pathname);
      if (publishPath && options.siteRegistry && request.method === 'POST') {
        const input = JSON.parse(await body(request)) as { siteIds?: unknown; kind?: 'static' | 'cms'; now?: string; confirmed?: boolean };
        if (input.kind === 'cms') {
          if (!options.cmsPublisher) throw new DomainError('unsupported', 'CMS publisher is not configured');
          const sites = selectSites(options.siteRegistry, input.siteIds, 'cms');
          if (publishPath.action !== 'publish') throw new DomainError('validation', 'CMS preview is not supported by this endpoint');
          json(response, 200, await options.cmsPublisher.publishManyDetailed(publishPath.id, sites, 4, requestAbort.signal));
          return;
        }
        if (!options.staticPublisher) throw new DomainError('unsupported', 'Static publisher is not configured');
        const sites = selectSites(options.siteRegistry, input.siteIds, 'static');
        if (publishPath.action === 'preview') {
          json(response, 200, await options.staticPublisher.preview(publishPath.id, sites, input.now ? new Date(input.now) : new Date(), requestAbort.signal));
          return;
        }
        if (input.confirmed !== true) throw new DomainError('cancelled', 'Static publish requires confirmed=true');
        json(response, 200, await options.staticPublisher.publishBatch(publishPath.id, sites, () => true, input.now ? new Date(input.now) : new Date(), requestAbort.signal));
        return;
      }
      const snapshotPath = snapshotPathFrom(url.pathname);
      if (snapshotPath && request.method === 'GET' && snapshotPath.revision === undefined) {
        json(response, 200, await repository.listSnapshots(snapshotPath.id));
        return;
      }
      if (snapshotPath && request.method === 'POST' && snapshotPath.action === 'restore') {
        const input = JSON.parse(await body(request)) as { expectedRevision?: number };
        if (!Number.isInteger(input.expectedRevision)) throw new DomainError('validation', 'expectedRevision is required');
        const restored = await repository.restoreSnapshot(snapshotPath.id, snapshotPath.revision!, input.expectedRevision!);
        json(response, 200, restored);
        return;
      }
      if (snapshotPath && request.method === 'DELETE' && snapshotPath.revision !== undefined) {
        await repository.deleteSnapshot(snapshotPath.id, snapshotPath.revision);
        response.statusCode = 204;
        response.end();
        return;
      }
      const articleId = idFrom(url.pathname);
      const restoreId = trashIdFrom(url.pathname, 'restore');
      if (request.method === 'POST' && restoreId) {
        await repository.restoreFromTrash(restoreId);
        json(response, 200, { restored: restoreId });
        return;
      }
      const deleteTrashId = trashIdFrom(url.pathname, 'delete');
      if (request.method === 'DELETE' && deleteTrashId) {
        await repository.deleteTrash(deleteTrashId);
        response.statusCode = 204;
        response.end();
        return;
      }
      if (articleId && request.method === 'GET') {
        const article = await repository.get(articleId);
        if (!article) { json(response, 404, { error: 'not found' }); return; }
        const format = url.searchParams.get('format');
        if (format) {
          if (!['markdown', 'html', 'pdf', 'docx', 'epub', 'png'].includes(format)) throw new DomainError('unsupported', `Unsupported export format: ${format}`);
          const exported = exportArticle(article, format as ExportFormat);
          response.statusCode = 200;
          response.setHeader('content-type', exported.mimeType);
          response.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`);
          response.end(Buffer.from(exported.bytes));
          return;
        }
        json(response, 200, article);
        return;
      }
      if (articleId && request.method === 'PUT') {
        const current = await repository.get(articleId);
        if (!current) { json(response, 404, { error: 'not found' }); return; }
        const input = JSON.parse(await body(request)) as ArticlePatchInput;
        if (!Number.isInteger(input.expectedRevision)) { json(response, 400, { error: 'expectedRevision is required' }); return; }
        if (input.expectedRevision !== current.localRevision) { json(response, 409, { error: 'revision conflict', current }); return; }
        const { expectedRevision: _expectedRevision, ...patch } = input;
        const next = updateArticle(current, patch);
        const result = await save.execute(next);
        if (result.state !== 'saved') { json(response, 409, { error: result.state }); return; }
        json(response, 200, next);
        return;
      }
      if (articleId && request.method === 'DELETE') {
        try {
          await repository.moveToTrash(articleId);
        } catch (error) {
          if (error instanceof DomainError && error.kind === 'notFound') { json(response, 404, { error: 'not found' }); return; }
          throw error;
        }
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/features') {
        const mode = url.searchParams.get('mode') === 'standard' ? 'standard' : 'simple';
        json(response, 200, visibleFeatures(mode));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/') {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(renderWebApp());
        return;
      }
      json(response, 404, { error: 'not found' });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : error instanceof DomainError ? domainErrorStatus(error.kind) : 500;
      json(response, status, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      request.off('aborted', abortRequest);
      response.off('close', abortRequest);
    }
  });
  server.listen(port);
  return server;
}

function domainErrorStatus(kind: DomainError['kind']): number {
  return {
    validation: 400,
    unauthorized: 403,
    security: 403,
    notFound: 404,
    conflict: 409,
    rateLimited: 429,
    cancelled: 499,
    network: 502,
    unsupported: 501,
    storage: 500,
  }[kind];
}
