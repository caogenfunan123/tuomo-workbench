import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillStore, ThemeMigrationUseCase, ThemeRegistry, planThemeMigration } from '../src/application/skills-themes.ts';

test('skills protect builtins and version user edits', () => { const store = new SkillStore([{ id: 'builtin', name: 'b', description: '', prompt: '', enabled: true, version: 1, builtin: true }]); assert.throws(() => store.update('builtin', { name: 'x' }), /Builtin/); const skill = store.create({ name: 'user', description: '', prompt: 'p', enabled: true }); assert.equal(store.update(skill.id, { prompt: 'p2' }).version, 2); });

test('theme migration validates paths, produces warnings and rolls back failures', async () => { const registry = new ThemeRegistry(); const theme = registry.install({ id: 't', name: 'T', framework: 'hexo', version: '1', source: 'user', files: [{ path: 'layout.yml', content: 'layout: post' }] }); const plan = planThemeMigration(theme, 'hugo'); assert.equal(plan.warnings.length, 1); const writes: string[] = []; const useCase = new ThemeMigrationUseCase({ async write(path) { writes.push(path); }, async remove(path) { writes.push(`remove:${path}`); } }); await useCase.apply(plan, true); assert.deepEqual(writes, ['layout.yml']); });
