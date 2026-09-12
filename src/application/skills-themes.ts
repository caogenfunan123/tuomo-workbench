import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath, newId } from '../domain/values.ts';
import type { StaticFramework } from '../domain/site.ts';

export type Skill = { id: string; name: string; description: string; prompt: string; enabled: boolean; version: number; builtin: boolean };
export class SkillStore {
  private readonly skills = new Map<string, Skill>();
  constructor(builtin: Skill[] = []) { for (const skill of builtin) this.skills.set(skill.id, structuredClone(skill)); }
  create(input: Omit<Skill, 'id' | 'version' | 'builtin'>): Skill { const skill = { ...input, id: newId(), version: 1, builtin: false }; this.skills.set(skill.id, skill); return structuredClone(skill); }
  update(id: string, patch: Partial<Pick<Skill, 'name' | 'description' | 'prompt' | 'enabled'>>): Skill { const current = this.skills.get(id); if (!current) throw new DomainError('notFound', 'Skill not found'); if (current.builtin) throw new DomainError('unsupported', 'Builtin skills must be overridden, not mutated'); const next = { ...current, ...patch, version: current.version + 1 }; this.skills.set(id, next); return structuredClone(next); }
  remove(id: string): void { const current = this.skills.get(id); if (!current) throw new DomainError('notFound', 'Skill not found'); if (current.builtin) throw new DomainError('unsupported', 'Builtin skills cannot be removed'); this.skills.delete(id); }
  list(): Skill[] { return [...this.skills.values()].map((skill) => structuredClone(skill)); }
}

export type ThemeFile = { path: string; content: string };
export type Theme = { id: string; name: string; framework: StaticFramework; version: string; files: ThemeFile[]; source: 'builtin' | 'user' | 'marketplace' };
export type ThemeMigrationPlan = { source: Theme; targetFramework: StaticFramework; files: ThemeFile[]; warnings: string[] };

export class ThemeRegistry {
  private readonly themes = new Map<string, Theme>();
  install(theme: Theme): Theme { const files = theme.files.map((file) => ({ path: SafeRelativePath.parse(file.path).value, content: file.content })); const value = { ...theme, files }; this.themes.set(theme.id, structuredClone(value)); return structuredClone(value); }
  get(id: string): Theme | undefined { const value = this.themes.get(id); return value ? structuredClone(value) : undefined; }
  list(): Theme[] { return [...this.themes.values()].map((theme) => structuredClone(theme)); }
}

export function planThemeMigration(theme: Theme, targetFramework: StaticFramework): ThemeMigrationPlan { const warnings: string[] = []; const files = theme.files.map((file) => { const safe = SafeRelativePath.parse(file.path); let content = file.content; if (targetFramework !== theme.framework && safe.value.endsWith('.yml')) { warnings.push(`YAML template may need manual conversion: ${safe.value}`); content = content.replace(/^layout:\s*.*$/gm, 'layout: default'); } return { path: safe.value, content }; }); return { source: structuredClone(theme), targetFramework, files, warnings }; }

export interface ThemeWriteGateway { write(path: string, content: string): Promise<void>; remove(path: string): Promise<void>; }
export class ThemeMigrationUseCase {
  private readonly gateway: ThemeWriteGateway;
  constructor(gateway: ThemeWriteGateway) { this.gateway = gateway; }
  async apply(plan: ThemeMigrationPlan, approved: boolean): Promise<{ written: string[]; rolledBack: string[] }> { if (!approved) throw new DomainError('cancelled', 'Theme migration requires approval'); const written: string[] = []; try { for (const file of plan.files) { await this.gateway.write(file.path, file.content); written.push(file.path); } return { written, rolledBack: [] }; } catch (error) { const rolledBack: string[] = []; for (const path of [...written].reverse()) { try { await this.gateway.remove(path); rolledBack.push(path); } catch { /* preserve a left-behind audit record at the caller */ } } throw new DomainError('storage', 'Theme migration rolled back', { written, rolledBack, cause: error instanceof Error ? error.message : String(error) }); } }
}
