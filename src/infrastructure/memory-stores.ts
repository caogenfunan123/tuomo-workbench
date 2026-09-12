import type { RemoteBinding } from '../domain/site.ts';
import type { BindingStore, SyncTransport } from '../application/ports.ts';

export class InMemoryBindingStore implements BindingStore {
  private readonly values = new Map<string, RemoteBinding>();
  private key(siteId: string, articleId: string): string { return `${siteId}:${articleId}`; }
  async get(siteId: string, articleId: string): Promise<RemoteBinding | undefined> { const value = this.values.get(this.key(siteId, articleId)); return value ? structuredClone(value) : undefined; }
  async put(binding: RemoteBinding): Promise<void> { this.values.set(this.key(binding.siteId, binding.articleId), structuredClone(binding)); }
}

export class InMemorySyncTransport implements SyncTransport {
  readonly objects: Record<string, { payload: string; revision: number; hash: string; modifiedAt: string }> = {};
  async pull(): Promise<{ objects: typeof this.objects }> { return { objects: structuredClone(this.objects) }; }
  async push(objects: typeof this.objects): Promise<void> { Object.assign(this.objects, structuredClone(objects)); }
}
