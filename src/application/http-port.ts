import { HttpJsonClient } from './http-client.ts';

export type FetchPort = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type JsonRequestOptions = { timeoutMs?: number; retries?: number; signal?: AbortSignal };
export interface JsonRequester { request<T>(url: string, init?: RequestInit, options?: JsonRequestOptions): Promise<T>; }

export class FetchJsonRequester implements JsonRequester {
  private readonly client: HttpJsonClient;
  constructor(fetcher: FetchPort = fetch) { this.client = new HttpJsonClient(fetcher); }
  request<T>(url: string, init: RequestInit = {}, options: JsonRequestOptions = {}): Promise<T> {
    return this.client.request<T>(url, init, options);
  }
}
