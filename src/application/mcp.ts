import { DomainError } from '../domain/errors.ts';

export type McpEndpoint = { kind: 'http' | 'sse' | 'stdio'; endpoint: string; allowedHosts: string[]; command?: string; enabled: boolean };
export type McpRequestOptions = { signal?: AbortSignal; timeoutMs?: number; retries?: number };
export type McpTransport = { request(message: Record<string, unknown>, options?: McpRequestOptions): Promise<Record<string, unknown>>; close(): Promise<void> };
export type McpClientInfo = { name: string; version: string };

export class McpConnection {
  private initialized = false;
  private initializeResult?: Record<string, unknown>;
  private readonly endpoint: McpEndpoint;
  private readonly transport: McpTransport;
  private readonly authorizeStdio: () => Promise<boolean> | boolean;
  constructor(endpoint: McpEndpoint, transport: McpTransport, authorizeStdio: () => Promise<boolean> | boolean = () => false) { this.endpoint = endpoint; this.transport = transport; this.authorizeStdio = authorizeStdio; }

  async initialize(clientInfo: McpClientInfo, options: McpRequestOptions = {}): Promise<Record<string, unknown>> {
    if (!this.endpoint.enabled) throw new DomainError('unauthorized', 'MCP endpoint is disabled');
    if (this.endpoint.kind === 'stdio' && !await this.authorizeStdio()) throw new DomainError('unauthorized', 'MCP stdio requires explicit authorization');
    if (this.endpoint.kind !== 'stdio') {
      const host = new URL(this.endpoint.endpoint).hostname;
      if (this.endpoint.allowedHosts.length && !this.endpoint.allowedHosts.includes(host)) throw new DomainError('security', `MCP host is not allow-listed: ${host}`);
    }
    if (this.initialized) return this.initializeResult!;
    const result = await this.transport.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo } }, options);
    if (result.error) throw new DomainError('network', 'MCP initialize failed', { error: result.error });
    this.initialized = true; this.initializeResult = result.result as Record<string, unknown>;
    return this.initializeResult;
  }
  async close(): Promise<void> { this.initialized = false; this.initializeResult = undefined; await this.transport.close(); }
}
