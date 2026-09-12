import { newId } from '../domain/values.ts';
import type { StaticFramework } from '../domain/site.ts';
import { markdownStats } from './content-tools.ts';

export type ArticleTemplate = { id: string; name: string; framework: StaticFramework; kind: 'post' | 'page'; frontMatter: string; version: number; builtin: boolean };
export class TemplateStore {
  private readonly values = new Map<string, ArticleTemplate>();
  constructor(builtin: ArticleTemplate[] = []) { for (const template of builtin) this.values.set(template.id, structuredClone(template)); }
  get(id: string): ArticleTemplate | undefined { const value = this.values.get(id); return value ? structuredClone(value) : undefined; }
  list(framework?: StaticFramework): ArticleTemplate[] { return [...this.values.values()].filter((template) => !framework || template.framework === framework).map((template) => structuredClone(template)); }
  save(template: Omit<ArticleTemplate, 'id' | 'version' | 'builtin'> & { id?: string; builtin?: boolean }): ArticleTemplate { const id = template.id ?? newId(); const current = this.values.get(id); if (current?.builtin) { const copy = { ...template, id: newId(), version: 1, builtin: false }; this.values.set(copy.id, copy); return structuredClone(copy); } const next = { ...template, id, version: (current?.version ?? 0) + 1, builtin: template.builtin ?? false }; this.values.set(id, next); return structuredClone(next); }
}

export type Snippet = { id: string; name: string; body: string; tags: string[]; updatedAt: string };
export class SnippetStore {
  private readonly values = new Map<string, Snippet>();
  save(input: Omit<Snippet, 'id' | 'updatedAt'> & { id?: string }): Snippet { const value = { ...input, id: input.id ?? newId(), tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))], updatedAt: new Date().toISOString() }; this.values.set(value.id, value); return structuredClone(value); }
  remove(id: string): void { this.values.delete(id); }
  search(text = ''): Snippet[] { const query = text.toLowerCase(); return [...this.values.values()].filter((snippet) => `${snippet.name} ${snippet.body} ${snippet.tags.join(' ')}`.toLowerCase().includes(query)).map((snippet) => structuredClone(snippet)); }
}

export function suggestTags(articles: Array<{ tags: string[]; categories: string[] }>, limit = 20): string[] { const counts = new Map<string, number>(); for (const article of articles) for (const value of [...article.tags, ...article.categories]) counts.set(value, (counts.get(value) ?? 0) + 1); return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit).map(([value]) => value); }

export type Volume = { id: string; name: string; articleIds: string[]; updatedAt: string };
export class VolumeStore {
  private readonly values = new Map<string, Volume>();
  save(input: { id?: string; name: string; articleIds?: string[] }): Volume {
    const id = input.id ?? newId();
    const current = this.values.get(id);
    const value: Volume = { id, name: input.name.trim(), articleIds: [...new Set(input.articleIds ?? current?.articleIds ?? [])], updatedAt: new Date().toISOString() };
    if (!value.name) throw new Error('Volume name cannot be empty');
    this.values.set(id, value);
    return structuredClone(value);
  }
  get(id: string): Volume | undefined { const value = this.values.get(id); return value ? structuredClone(value) : undefined; }
  list(): Volume[] { return [...this.values.values()].sort((left, right) => left.name.localeCompare(right.name)).map((value) => structuredClone(value)); }
  addArticle(id: string, articleId: string): Volume { const volume = this.values.get(id); if (!volume) throw new Error(`Volume not found: ${id}`); return this.save({ ...volume, articleIds: [...volume.articleIds, articleId] }); }
  removeArticle(id: string, articleId: string): Volume { const volume = this.values.get(id); if (!volume) throw new Error(`Volume not found: ${id}`); return this.save({ ...volume, articleIds: volume.articleIds.filter((value) => value !== articleId) }); }
  remove(id: string): void { this.values.delete(id); }
}

export type WritingStats = { totalWords: number; totalCharacters: number; articles: number; updatedAt: string };
export class WritingStatsStore {
  private stats: WritingStats = { totalWords: 0, totalCharacters: 0, articles: 0, updatedAt: new Date().toISOString() };
  recompute(articles: Array<{ body: string }>): WritingStats { const totals = articles.map((article) => markdownStats(article.body)); this.stats = { totalWords: totals.reduce((sum, value) => sum + value.words, 0), totalCharacters: totals.reduce((sum, value) => sum + value.characters, 0), articles: articles.length, updatedAt: new Date().toISOString() }; return { ...this.stats }; }
  get(): WritingStats { return { ...this.stats }; }
}

export type WritingLibrarySnapshot = { templates: ArticleTemplate[]; snippets: Snippet[]; volumes: Volume[]; stats: WritingStats };
export interface WritingLibraryRepository {
  read(): Promise<WritingLibrarySnapshot>;
  saveTemplate(template: Omit<ArticleTemplate, 'id' | 'version' | 'builtin'> & { id?: string; builtin?: boolean }): Promise<ArticleTemplate>;
  removeTemplate(id: string): Promise<void>;
  saveSnippet(input: Omit<Snippet, 'id' | 'updatedAt'> & { id?: string }): Promise<Snippet>;
  removeSnippet(id: string): Promise<void>;
  saveVolume(input: { id?: string; name: string; articleIds?: string[] }): Promise<Volume>;
  addArticleToVolume(id: string, articleId: string): Promise<Volume>;
  removeArticleFromVolume(id: string, articleId: string): Promise<Volume>;
  removeVolume(id: string): Promise<void>;
  recomputeStats(articles: Array<{ body: string }>): Promise<WritingStats>;
}
