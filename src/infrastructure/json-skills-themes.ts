import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath, newId } from '../domain/values.ts';
import type { StaticFramework } from '../domain/site.ts';
import type { Skill, Theme, ThemeFile } from '../application/skills-themes.ts';

type SkillFile = { schemaVersion: 1; skills: Skill[] };
type ThemeFileEnvelope = { schemaVersion: 1; themes: Theme[] };

export class JsonSkillStore {
  private readonly path: string;
  private readonly values = new Map<string, Skill>();
  private readonly builtins = new Set<string>();
  private loaded = false;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(path: string, builtin: Skill[] = []) {
    this.path = path;
    for (const skill of builtin) { this.values.set(skill.id, structuredClone(skill)); this.builtins.add(skill.id); }
  }

  async create(input: Omit<Skill, 'id' | 'version' | 'builtin'>): Promise<Skill> {
    await this.ensureLoaded();
    const value: Skill = { ...input, id: newId(), version: 1, builtin: false };
    this.values.set(value.id, value);
    await this.persistQueued();
    return structuredClone(value);
  }

  async update(id: string, patch: Partial<Pick<Skill, 'name' | 'description' | 'prompt' | 'enabled'>>): Promise<Skill> {
    this.assertId(id);
    await this.ensureLoaded();
    const current = this.values.get(id);
    if (!current) throw new DomainError('notFound', 'Skill not found');
    if (this.builtins.has(id) || current.builtin) throw new DomainError('unsupported', 'Builtin skills must be overridden, not mutated');
    const next = { ...current, ...patch, version: current.version + 1, builtin: false };
    this.values.set(id, next);
    await this.persistQueued();
    return structuredClone(next);
  }

  async remove(id: string): Promise<void> {
    this.assertId(id);
    await this.ensureLoaded();
    const current = this.values.get(id);
    if (!current) throw new DomainError('notFound', 'Skill not found');
    if (this.builtins.has(id) || current.builtin) throw new DomainError('unsupported', 'Builtin skills cannot be removed');
    this.values.delete(id);
    await this.persistQueued();
  }

  async list(): Promise<Skill[]> { await this.ensureLoaded(); return [...this.values.values()].map((skill) => structuredClone(skill)); }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const value = JSON.parse(await fs.readFile(this.path, 'utf8')) as SkillFile;
      if (value.schemaVersion !== 1 || !Array.isArray(value.skills)) throw new DomainError('storage', 'Unsupported skill schema');
      for (const skill of value.skills) { this.assertId(skill.id); if (!this.builtins.has(skill.id)) this.values.set(skill.id, structuredClone({ ...skill, builtin: false })); }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error instanceof DomainError ? error : new DomainError('storage', `Unable to read skills: ${error?.message ?? String(error)}`);
      await this.persist();
    }
  }

  private async persistQueued(): Promise<void> { this.writeTail = this.writeTail.then(() => this.persist()); await this.writeTail; }
  private async persist(): Promise<void> { const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`; await fs.mkdir(dirname(this.path), { recursive: true }); const skills = [...this.values.values()].filter((skill) => !this.builtins.has(skill.id)); await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, skills }, null, 2), { flag: 'wx' }); await fs.rename(temporary, this.path); }
  private assertId(value: string): void { if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new DomainError('security', 'Skill id is invalid'); }
}

export class JsonThemeRegistry {
  private readonly path: string;
  private readonly themes = new Map<string, Theme>();
  private loaded = false;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(path: string, builtin: Theme[] = []) { this.path = path; for (const theme of builtin) this.themes.set(theme.id, this.normalize(theme)); }

  async install(theme: Theme): Promise<Theme> {
    await this.ensureLoaded();
    const value = this.normalize(theme);
    this.themes.set(value.id, value);
    await this.persistQueued();
    return structuredClone(value);
  }

  async get(id: string): Promise<Theme | undefined> { this.assertId(id); await this.ensureLoaded(); const value = this.themes.get(id); return value ? structuredClone(value) : undefined; }
  async list(): Promise<Theme[]> { await this.ensureLoaded(); return [...this.themes.values()].map((theme) => structuredClone(theme)); }

  async remove(id: string): Promise<void> {
    this.assertId(id);
    await this.ensureLoaded();
    const current = this.themes.get(id);
    if (!current) throw new DomainError('notFound', 'Theme not found');
    if (current.source === 'builtin') throw new DomainError('unsupported', 'Builtin themes cannot be removed');
    this.themes.delete(id);
    await this.persistQueued();
  }

  private normalize(theme: Theme): Theme { this.assertId(theme.id); return { ...theme, files: theme.files.map((file: ThemeFile) => ({ path: SafeRelativePath.parse(file.path).value, content: file.content })) }; }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const value = JSON.parse(await fs.readFile(this.path, 'utf8')) as ThemeFileEnvelope;
      if (value.schemaVersion !== 1 || !Array.isArray(value.themes)) throw new DomainError('storage', 'Unsupported theme schema');
      for (const theme of value.themes) { const normalized = this.normalize(theme); if (normalized.source !== 'builtin') this.themes.set(normalized.id, normalized); }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error instanceof DomainError ? error : new DomainError('storage', `Unable to read themes: ${error?.message ?? String(error)}`);
      await this.persist();
    }
  }

  private async persistQueued(): Promise<void> { this.writeTail = this.writeTail.then(() => this.persist()); await this.writeTail; }
  private async persist(): Promise<void> { const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`; await fs.mkdir(dirname(this.path), { recursive: true }); const themes = [...this.themes.values()].filter((theme) => theme.source !== 'builtin'); await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, themes }, null, 2), { flag: 'wx' }); await fs.rename(temporary, this.path); }
  private assertId(value: string): void { if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new DomainError('security', 'Theme id is invalid'); }
}

export type PersistedThemeInput = { id: string; name: string; framework: StaticFramework; version: string; files: ThemeFile[]; source: Theme['source'] };
