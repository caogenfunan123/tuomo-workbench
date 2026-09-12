import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { DomainError } from '../domain/errors.ts';
import type { JsonSettingsStore } from './settings-store.ts';
import type { FetchLike } from '../application/http-client.ts';

type RequestFunction = typeof httpRequest;

export function createProxyFetch(proxyUrl: string): FetchLike {
  const proxy = parseProxy(proxyUrl);
  return (input, init = {}) => requestThroughProxy(new URL(String(input)), init, proxy);
}

export function createSettingsAwareFetch(settings: JsonSettingsStore): FetchLike {
  let cachedUrl: string | undefined;
  let cached: FetchLike = fetch;
  return async (input, init = {}) => {
    const proxyUrl = (await settings.read())?.proxyUrl?.trim() || undefined;
    if (proxyUrl !== cachedUrl) {
      cachedUrl = proxyUrl;
      cached = proxyUrl ? createProxyFetch(proxyUrl) : fetch;
    }
    return cached(input, init);
  };
}

function parseProxy(value: string): URL {
  let proxy: URL;
  try { proxy = new URL(value); } catch { throw new DomainError('validation', 'Proxy URL is invalid'); }
  if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password) throw new DomainError('security', 'Proxy URL must be HTTP(S) without embedded credentials');
  return proxy;
}

async function requestThroughProxy(target: URL, init: RequestInit, proxy: URL): Promise<Response> {
  if (!['http:', 'https:'].includes(target.protocol)) throw new DomainError('validation', 'Only HTTP(S) requests can use the proxy');
  const body = await bodyBytes(init.body);
  const headers = headerRecord(init.headers);
  if (body && !headers['content-length']) headers['content-length'] = String(body.byteLength);
  if (target.protocol === 'http:') {
    return execute(proxyRequest(proxy), {
      hostname: proxy.hostname,
      port: proxy.port || undefined,
      method: init.method ?? 'GET',
      path: target.toString(),
      headers: { ...headers, host: target.host },
    }, body, init.signal);
  }
  return requestHttpsThroughConnect(target, proxy, init, headers, body);
}

function requestHttpsThroughConnect(target: URL, proxy: URL, init: RequestInit, headers: Record<string, string>, body?: Uint8Array): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const connect = proxyRequest(proxy)({
      hostname: proxy.hostname,
      port: proxy.port || undefined,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || '443'}`,
      headers: { host: `${target.hostname}:${target.port || '443'}` },
    });
    let settled = false;
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    connect.once('error', fail);
    connect.once('connect', (response: IncomingMessage, socket, head) => {
      if (response.statusCode !== 200) { socket.destroy(); fail(new DomainError('network', `Proxy CONNECT failed: ${response.statusCode ?? 0}`)); return; }
      if (head.length) socket.unshift(head);
      const secure = tlsConnect({ socket, servername: target.hostname });
      secure.once('error', fail);
      secure.once('secureConnect', () => {
        execute(httpsRequest, {
          hostname: target.hostname,
          port: target.port || 443,
          method: init.method ?? 'GET',
          path: `${target.pathname}${target.search}`,
          headers,
          agent: false,
          createConnection: () => secure,
        }, body, init.signal).then((value) => { if (!settled) { settled = true; resolve(value); } }, fail);
      });
    });
    bindAbort(init.signal, connect, fail);
    connect.end();
  });
}

function proxyRequest(proxy: URL): RequestFunction {
  return proxy.protocol === 'https:' ? httpsRequest : httpRequest;
}

function execute(request: RequestFunction, options: Record<string, unknown>, body: Uint8Array | undefined, signal?: AbortSignal): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const client = request(options as any, (response) => {
      const chunks: Uint8Array[] = [];
      response.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      response.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) headers.set(key, value.join(', '));
          else if (value !== undefined) headers.set(key, String(value));
        }
        resolve(new Response(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers }));
      });
      response.on('error', reject);
    });
    bindAbort(signal, client, reject);
    client.on('error', reject);
    if (body) client.write(body);
    client.end();
  });
}

function bindAbort(signal: AbortSignal | undefined, request: ClientRequest, reject: (error: unknown) => void): void {
  if (!signal) return;
  const abort = () => { request.destroy(); reject(new DomainError('cancelled', 'Request cancelled')); };
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
}

function headerRecord(value: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(value);
  return Object.fromEntries(headers.entries());
}

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new DomainError('unsupported', 'Proxy fetch only supports buffered request bodies');
}
