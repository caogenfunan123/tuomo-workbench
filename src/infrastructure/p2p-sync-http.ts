import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import type { Server as NetServer } from 'node:net';
import { DomainError } from '../domain/errors.ts';
import type { SyncTransport } from '../application/ports.ts';
import type { GatewayRequestOptions } from '../application/ports.ts';
import type { SyncObjectPayload } from '../application/sync-transports.ts';
import { EncryptedP2PSession } from '../application/sync-transports.ts';
import { HttpJsonClient } from './http-client.ts';
import type { FetchLike } from './http-client.ts';

export type P2PSyncRequest = { kind: 'pull' | 'push'; objects?: Record<string, SyncObjectPayload> };
export type P2PSyncHandler = (request: P2PSyncRequest) => Promise<{ objects: Record<string, SyncObjectPayload> }>;
export type P2PTlsOptions = Pick<HttpsServerOptions, 'key' | 'cert' | 'ca' | 'requestCert' | 'rejectUnauthorized'>;
export type P2PSyncServerOptions = { trustedPeerFingerprints?: readonly string[]; maxBytes?: number; maxObjects?: number; tls?: P2PTlsOptions; requireTls?: boolean };
export type P2PSyncClientOptions = { peerFingerprint?: string; timeoutMs?: number; signal?: AbortSignal; retries?: number; requireTls?: boolean };

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  let value = '';
  for await (const chunk of request) {
    value += chunk.toString('utf8');
    if (value.length > maxBytes) throw new DomainError('validation', 'P2P request is too large');
  }
  return value;
}

function respond(response: ServerResponse, status: number, value: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(value);
}

export class P2PSyncHttpServer {
  private readonly server: NetServer;
  private readonly session: EncryptedP2PSession;
  private readonly handler: P2PSyncHandler;
  constructor(session: EncryptedP2PSession, handler: P2PSyncHandler, options: P2PSyncServerOptions = {}) {
    if (options.requireTls && !options.tls) throw new DomainError('security', 'P2P production mode requires TLS certificate options');
    this.session = session;
    this.handler = handler;
    const maxBytes = options.maxBytes ?? 5_000_000;
    const trusted = new Set(options.trustedPeerFingerprints ?? []);
    const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
      try {
        if (request.method !== 'POST' || new URL(request.url ?? '/', 'http://localhost').pathname !== '/sync') { respond(response, 404, 'not found'); return; }
        if (trusted.size && !trusted.has(String(request.headers['x-tuomo-peer-fingerprint'] ?? ''))) { respond(response, 401, 'untrusted peer'); return; }
        const decoded = JSON.parse(this.session.decrypt(await readBody(request, maxBytes))) as P2PSyncRequest;
        if (decoded.kind !== 'pull' && decoded.kind !== 'push') throw new DomainError('validation', 'Invalid P2P request kind');
        if (decoded.kind === 'push' && (!decoded.objects || Object.keys(decoded.objects).length > (options.maxObjects ?? 500))) throw new DomainError('validation', 'P2P object limit exceeded');
        const result = await this.handler(decoded);
        const encrypted = this.session.encrypt(JSON.stringify(result));
        if (encrypted.length > maxBytes) throw new DomainError('validation', 'P2P response is too large');
        respond(response, 200, encrypted);
      } catch (error) {
        const status = error instanceof DomainError && error.kind === 'validation' ? 400 : error instanceof DomainError && error.kind === 'security' ? 401 : 500;
        respond(response, status, error instanceof Error ? error.message : String(error));
      }
    };
    this.server = options.tls ? createHttpsServer(options.tls, requestHandler) : createHttpServer(requestHandler);
  }

  async listen(port = 0): Promise<number> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', () => resolve()); });
    return (this.server.address() as AddressInfo).port;
  }

  async close(): Promise<void> { if (!this.server.listening) return; await new Promise<void>((resolve) => this.server.close(() => resolve())); }
}

export class EncryptedP2PSyncTransport implements SyncTransport {
  private readonly endpoint: string;
  private readonly session: EncryptedP2PSession;
  private readonly client: HttpJsonClient;
  private readonly options: P2PSyncClientOptions;
  constructor(endpoint: string, session: EncryptedP2PSession, fetcher: FetchLike = fetch, options: P2PSyncClientOptions = {}) { if (options.requireTls && !endpoint.toLowerCase().startsWith('https://')) throw new DomainError('security', 'P2P production mode requires an https endpoint'); this.endpoint = endpoint; this.session = session; this.client = new HttpJsonClient(fetcher); this.options = options; }

  async pull(options: GatewayRequestOptions = {}): Promise<{ objects: Record<string, SyncObjectPayload> }> { return this.request({ kind: 'pull' }, options); }
  async push(objects: Record<string, SyncObjectPayload>, options: GatewayRequestOptions = {}): Promise<void> { await this.request({ kind: 'push', objects }, options); }

  private async request(request: P2PSyncRequest, options: GatewayRequestOptions = {}): Promise<{ objects: Record<string, SyncObjectPayload> }> {
    const text = await this.client.requestText(`${this.endpoint.replace(/\/$/, '')}/sync`, { method: 'POST', headers: { 'content-type': 'text/plain', ...(this.options.peerFingerprint ? { 'x-tuomo-peer-fingerprint': this.options.peerFingerprint } : {}) }, body: this.session.encrypt(JSON.stringify(request)) }, { timeoutMs: options.timeoutMs ?? this.options.timeoutMs ?? 15_000, signal: options.signal ?? this.options.signal, retries: options.retries ?? this.options.retries ?? 0 });
    try { return JSON.parse(this.session.decrypt(text.body)) as { objects: Record<string, SyncObjectPayload> }; } catch { throw new DomainError('security', 'P2P response authentication failed'); }
  }
}
