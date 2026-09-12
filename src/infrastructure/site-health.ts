import type { Site } from '../domain/site.ts';
import { FetchJsonRequester } from '../application/http-port.ts';
import type { FetchPort, JsonRequester } from '../application/http-port.ts';
import type { SiteCheck } from '../application/sites.ts';
import type { GatewayRequestOptions } from '../application/ports.ts';

export function createHttpSiteCheck(requesterOrFetcher?: JsonRequester | FetchPort): SiteCheck { const requester = typeof requesterOrFetcher === 'function' ? new FetchJsonRequester(requesterOrFetcher) : requesterOrFetcher ?? new FetchJsonRequester(); return async (site: Site, options: GatewayRequestOptions = {}) => { const url = site.url ?? (site.kind === 'cms' ? site.config.baseUrl : site.config.url); if (!url) return { reachable: false, pageNonEmpty: false }; const value = await requester.request<unknown>(url, { method: 'GET' }, { ...options, timeoutMs: options.timeoutMs ?? 15_000, retries: options.retries ?? 1 }); const text = typeof value === 'string' ? value : JSON.stringify(value); return { reachable: true, pageNonEmpty: Boolean(text.trim()) }; }; }
