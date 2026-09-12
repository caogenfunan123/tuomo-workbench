import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import { newId } from '../domain/values.ts';
import type { StaticFramework } from '../domain/site.ts';
import { markdownStats } from '../application/content-tools.ts';
import type { ArticleTemplate, Snippet, Volume, WritingLibraryRepository, WritingLibrarySnapshot, WritingStats } from '../application/writing-library.ts';

type LibraryFile = { schemaVersion: 1; templates: ArticleTemplate[]; snippets: Snippet[]; volumes: Volume[]; stats: WritingStats };

/** Persistent templates, snippets, volumes and writing statistics. */
export class JsonWritingLibraryStore implements WritingLibraryRepository {
  private readonly path: string;
  private data: LibraryFile = { schemaVersion: 1, templates: [], snippets: [], volumes: [], stats: { totalWords: 0, totalCharacters: 0, articles: 0, updatedAt: new Date().toISOString() } };
  private loaded = false;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(path: string) { this.path = path; }

  async read(): Promise<WritingLibrarySnapshot> {
    await this.ensureLoaded();
    return structuredClone(this.snapshot());
  }

  async saveTemplate(input: Omit<ArticleTemplate, 'id' | 'version' | 'builtin'> & { id?: string; builtin?: boolean }): Promise<ArticleTemplate> {
    await this.ensureLoaded();
    if (!input.name.trim() || !input.frontMatter.trim()) throw new DomainError('validation', 'Template name and front matter are required');
    const id = input.id ?? newId();
    const current = this.data.templates.find((template) => template.id === id);
    const value: ArticleTemplate = current?.builtin
      ? { ...input, id: newId(), version: 1, builtin: false }
      : { ...input, id, version: (current?.version ?? 0) + 1, builtin: input.builtin ?? false };
    this.data.templates = [...this.data.templates.filter((template) => template.id !== value.id), structuredClone(value)];
    await this.persistQueued();
    return structuredClone(value);
  }

  async removeTemplate(id: string): Promise<void> {
    this.assertId(id);
    await this.ensureLoaded();
    const current = this.data.templates.find((template) => template.id === id);
    if (!current) throw new DomainError('notFound', 'Template not found');
    if (current.builtin) throw new DomainError('unsupported', 'Builtin templates cannot be removed');
    this.data.templates = this.data.templates.filter((template) => template.id !== id);
    await this.persistQueued();
  }

  async saveSnippet(input: Omit<Snippet, 'id' | 'updatedAt'> & { id?: string }): Promise<Snippet> {
    await this.ensureLoaded();
    if (!input.name.trim()) throw new DomainError('validation', 'Snippet name cannot be empty');
    const value: Snippet = { ...input, id: input.id ?? newId(), tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))], updatedAt: new Date().toISOString() };
    this.data.snippets = [...this.data.snippets.filter((snippet) => snippet.id !== value.id), structuredClone(value)];
    await this.persistQueued();
    return structuredClone(value);
  }

  async removeSnippet(id: string): Promise<void> {
    this.assertId(id);
    await this.ensureLoaded();
    this.data.snippets = this.data.snippets.filter((snippet) => snippet.id !== id);
    await this.persistQueued();
  }

  async saveVolume(input: { id?: string; name: string; articleIds?: string[] }): Promise<Volume> {
    await this.ensureLoaded();
    const name = input.name.trim();
    if (!name) throw new DomainError('validation', 'Volume name cannot be empty');
    const id = input.id ?? newId();
    this.assertId(id);
    const current = this.data.volumes.find((volume) => volume.id === id);
    const value: Volume = { id, name, articleIds: [...new Set(input.articleIds ?? current?.articleIds ?? [])], updatedAt: new Date().toISOString() };
    this.data.volumes = [...this.data.volumes.filter((volume) => volume.id !== id), value];
    await this.persistQueued();
    return structuredClone(value);
  }

  async addArticleToVolume(id: string, articleId: string): Promise<Volume> {
    const current = await this.findVolume(id);
    return this.saveVolume({ id, name: current.name, articleIds: [...current.articleIds, articleId] });
  }

  async removeArticleFromVolume(id: string, articleId: string): Promise<Volume> {
    const current = await this.findVolume(id);
    return this.saveVolume({ id, name: current.name, articleIds: current.articleIds.filter((value) => value !== articleId) });
  }

  async removeVolume(id: string): Promise<void> {
    this.assertId(id);
    await this.ensureLoaded();
    if (!this.data.volumes.some((volume) => volume.id === id)) throw new DomainError('notFound', 'Volume not found');
    this.data.volumes = this.data.volumes.filter((volume) => volume.id !== id);
    await this.persistQueued();
  }

  async recomputeStats(articles: Array<{ body: string }>): Promise<WritingStats> {
    await this.ensureLoaded();
    const totals = articles.map((article) => markdownStats(article.body));
    this.data.stats = { totalWords: totals.reduce((sum, value) => sum + value.words, 0), totalCharacters: totals.reduce((sum, value) => sum + value.characters, 0), articles: articles.length, updatedAt: new Date().toISOString() };
    await this.persistQueued();
    return structuredClone(this.data.stats);
  }

  private async findVolume(id: string): Promise<Volume> {
    this.assertId(id);
    await this.ensureLoaded();
    const value = this.data.volumes.find((volume) => volume.id === id);
    if (!value) throw new DomainError('notFound', 'Volume not found');
    return structuredClone(value);
  }

  private snapshot(): WritingLibrarySnapshot { return { templates: this.data.templates, snippets: this.data.snippets, volumes: this.data.volumes, stats: this.data.stats }; }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const value = JSON.parse(await fs.readFile(this.path, 'utf8')) as LibraryFile;
      if (value.schemaVersion !== 1 || !Array.isArray(value.templates) || !Array.isArray(value.snippets) || !Array.isArray(value.volumes)) throw new DomainError('storage', 'Unsupported writing library schema');
      this.data = { schemaVersion: 1, templates: value.templates, snippets: value.snippets, volumes: value.volumes, stats: value.stats ?? this.data.stats };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error instanceof DomainError ? error : new DomainError('storage', `Unable to read writing library: ${error?.message ?? String(error)}`);
      await this.persist();
    }
  }

  private async persistQueued(): Promise<void> {
    this.writeTail = this.writeTail.then(() => this.persist());
    await this.writeTail;
  }

  private async persist(): Promise<void> {
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(this.data, null, 2), { flag: 'wx' });
    await fs.rename(temporary, this.path);
  }

  private assertId(value: string): void { if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new DomainError('security', 'Writing library id is invalid'); }
}
