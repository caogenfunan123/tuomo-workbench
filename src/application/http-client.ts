import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.ts';

export type HttpClientOptions = { timeoutMs?: number; retries?: number; signal?: AbortSignal; headers?: Record<string, string> };
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type HttpTextResponse = { status: number; body: string; requestId: string };

export class HttpJsonClient {
  private readonly fetcher: FetchLike;
  constructor(fetcher: FetchLike = fetch) { this.fetcher = fetcher; }

  async request<T>(url: string, init: RequestInit = {}, options: HttpClientOptions = {}): Promise<T> {
    const response = await this.requestText(url, init, options);
    let body: unknown;
    try { body = response.body ? JSON.parse(response.body) : undefined; } catch { body = response.body; }
    return body as T;
  }

  async requestText(url: string, init: RequestInit = {}, options: HttpClientOptions = {}): Promise<HttpTextResponse> {
    if (options.signal?.aborted) throw new DomainError('cancelled', `Request cancelled: ${url}`);
    const method = String(init.method ?? 'GET').toUpperCase();
    const defaultRetries = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method) ? 2 : 0;
    const attempts = options.retries ?? defaultRetries; let lastError: unknown;
    for (let attempt = 0; attempt <= attempts; attempt++) {
      if (options.signal?.aborted) throw new DomainError('cancelled', `Request cancelled: ${url}`);
      const controller = new AbortController(); let timedOut = false; const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15_000);
      const requestId = randomUUID();
      const onAbort = () => controller.abort(); options.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await this.fetcher(url, { ...init, signal: controller.signal, headers: { accept: 'application/json', ...options.headers, ...(init.headers ?? {}), 'x-request-id': requestId } });
        const body = await response.text();
        if (response.ok) return { status: response.status, body, requestId };
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < attempts) { await waitWithCancellation(Math.min(250 * 2 ** attempt, 2_000), options.signal); continue; }
        throw new DomainError(response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 404 ? 'notFound' : response.status === 409 ? 'conflict' : response.status === 429 ? 'rateLimited' : 'network', `HTTP ${response.status} for ${url}`, { status: response.status, requestId, body });
      } catch (error) {
        if (options.signal?.aborted) throw new DomainError('cancelled', `Request cancelled: ${url}`, { requestId });
        lastError = error;
        if (timedOut && attempt >= attempts) throw new DomainError('network', `Request timed out: ${url}`, { requestId, timeoutMs: options.timeoutMs ?? 15_000 });
        if (error instanceof DomainError && !['network', 'rateLimited'].includes(error.kind)) throw error;
        if (attempt >= attempts) throw error instanceof DomainError ? error : new DomainError('network', `Request failed: ${url}`, { requestId });
      } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', onAbort); }
    }
    throw lastError;
  }
}

async function waitWithCancellation(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DomainError('cancelled', 'Request cancelled during retry backoff');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(new DomainError('cancelled', 'Request cancelled during retry backoff')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
