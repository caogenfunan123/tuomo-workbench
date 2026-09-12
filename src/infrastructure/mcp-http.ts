import type { McpRequestOptions, McpTransport } from '../application/mcp.ts';
import { FetchJsonRequester } from '../application/http-port.ts';
import type { FetchPort, JsonRequester } from '../application/http-port.ts';

export class HttpMcpTransport implements McpTransport {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly requester: JsonRequester;
  private readonly sse: boolean;
  constructor(endpoint: string, headers: Record<string, string> = {}, requesterOrFetcher?: JsonRequester | FetchPort, sse = false) { this.endpoint = endpoint; this.headers = headers; this.requester = typeof requesterOrFetcher === 'function' ? new FetchJsonRequester(requesterOrFetcher) : requesterOrFetcher ?? new FetchJsonRequester(); this.sse = sse; }
  async request(message: Record<string, unknown>, options: McpRequestOptions = {}): Promise<Record<string, unknown>> { const value = await this.requester.request<unknown>(this.endpoint, { method: 'POST', headers: { ...this.headers, 'content-type': 'application/json', ...(this.sse ? { accept: 'text/event-stream' } : {}) }, body: JSON.stringify(message) }, options); if (!this.sse) return value as Record<string, unknown>; const text = String(value); const data = text.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim() ?? text; return JSON.parse(data) as Record<string, unknown>; }
  async close(): Promise<void> {}
}
