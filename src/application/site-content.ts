import type { CmsPost, CmsPostGateway, PostQuery, SiteRegistry } from './ports.ts';
import type { RemoteArticle, RemoteArticleQuery } from './remote-articles.ts';
import type { CmsSite, Site, StaticSite } from '../domain/site.ts';

export type AggregatedContentItem = {
  siteId: string;
  siteName: string;
  siteKind: Site['kind'];
  remoteId?: string;
  path?: string;
  title: string;
  content?: string;
  revision?: string;
  updatedAt?: string;
  status?: 'draft' | 'published';
};

export interface StaticContentReader {
  list(site: StaticSite, query?: RemoteArticleQuery): Promise<RemoteArticle[]>;
}

export type SiteContentQuery = { siteIds?: string[]; kind?: Site['kind']; text?: string; limit?: number };

async function mapConcurrent<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  async function consume(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, consume));
  return output;
}

export class SiteContentQueryUseCase {
  private readonly registry: SiteRegistry;
  private readonly staticReader?: StaticContentReader;
  private readonly cmsReader?: CmsPostGateway;
  private readonly concurrency: number;

  constructor(registry: SiteRegistry, readers: { static?: StaticContentReader; cms?: CmsPostGateway }, concurrency = 4) {
    this.registry = registry;
    this.staticReader = readers.static;
    this.cmsReader = readers.cms;
    this.concurrency = Math.max(1, Math.min(4, concurrency));
  }

  async list(query: SiteContentQuery = {}): Promise<AggregatedContentItem[]> {
    const selected = this.registry.list().filter((site) => (!query.kind || site.kind === query.kind) && (!query.siteIds || query.siteIds.includes(site.id)));
    const groups = await mapConcurrent(selected, this.concurrency, async (site) => this.readSite(site, query));
    return groups.flat().filter((item) => !query.text || `${item.title} ${item.content ?? ''} ${item.path ?? ''}`.toLowerCase().includes(query.text.toLowerCase())).slice(0, query.limit ?? Number.MAX_SAFE_INTEGER);
  }

  private async readSite(site: Site, query: SiteContentQuery): Promise<AggregatedContentItem[]> {
    if (site.kind === 'static') {
      if (!this.staticReader) return [];
      const values = await this.staticReader.list(site, { text: query.text, limit: query.limit });
      return values.map((value) => this.mapStatic(site, value));
    }
    if (!this.cmsReader) return [];
    const values = await this.cmsReader.list(site, { text: query.text, limit: query.limit } satisfies PostQuery);
    return values.map((value) => this.mapCms(site, value));
  }

  private mapStatic(site: StaticSite, value: RemoteArticle): AggregatedContentItem {
    const path = value.path;
    return { siteId: site.id, siteName: site.name, siteKind: site.kind, path, title: value.title ?? path.split('/').at(-1)?.replace(/\.md$/i, '') ?? path, content: value.content, revision: value.revision, updatedAt: value.updatedAt };
  }

  private mapCms(site: CmsSite, value: CmsPost): AggregatedContentItem {
    return { siteId: site.id, siteName: site.name, siteKind: site.kind, remoteId: value.id, title: value.title, content: value.markdown, revision: value.revision, updatedAt: value.updatedAt, status: value.status };
  }
}
