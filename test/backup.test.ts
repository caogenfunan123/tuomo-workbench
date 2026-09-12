import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createBackup, createWorkspaceBackup, planRestore, readBackup, readWorkspaceBackup } from '../src/application/backup.ts';

test('backup archive validates paths, integrity and optional AES-GCM encryption', () => {
  const key = randomBytes(32); const source = [{ path: 'articles/a.json', data: '{"ok":true}' }, { path: 'settings/public.json', data: '{}' }];
  const archive = createBackup(source, key); assert.deepEqual(readBackup(archive, key), source); assert.throws(() => readBackup(archive, randomBytes(32)));
  const tampered = { ...archive, manifestHash: 'bad' }; assert.throws(() => readBackup(tampered, key));
  assert.throws(() => createBackup([{ path: '../escape', data: 'x' }]));
});

test('workspace backup includes all portable data and protects the device key', () => {
  const data = { settings: { mode: 'standard' }, repos: [], drafts: [{ id: 'a' }], templates: [], snippets: [], writingStats: { words: 1 }, sites: [], library: { volumes: [{ id: 'v' }] }, skills: [{ id: 'skill' }], themes: [{ id: 'theme' }], agentSessions: [{ id: 'session' }], agentTasks: [{ id: 'task' }], syncManifest: { objects: [] }, deviceKey: 'device-secret' };
  assert.throws(() => createWorkspaceBackup(data), /encrypted backup/);
  const key = new Uint8Array(32).fill(4);
  const archive = createWorkspaceBackup(data, key);
  const restored = readWorkspaceBackup(archive, key);
  assert.equal(restored.deviceKey, 'device-secret');
  assert.deepEqual(restored.drafts, [{ id: 'a' }]);
  assert.deepEqual(restored.library, { volumes: [{ id: 'v' }] });
  assert.deepEqual(restored.skills, [{ id: 'skill' }]);
  assert.deepEqual(restored.themes, [{ id: 'theme' }]);
  assert.deepEqual(restored.agentSessions, [{ id: 'session' }]);
  assert.deepEqual(restored.agentTasks, [{ id: 'task' }]);
  assert.deepEqual(restored.syncManifest, { objects: [] });
  const legacyArchive = createWorkspaceBackup({ settings: {}, repos: [], drafts: [], templates: [], snippets: [], writingStats: {}, sites: [] }, key);
  assert.equal(readWorkspaceBackup(legacyArchive, key).library, undefined);
});

test('restore defaults to preview and does not overwrite existing paths', () => {
  const plan = planRestore([{ path: 'a.txt', data: 'a' }, { path: 'b.txt', data: 'b' }], ['b.txt']);
  assert.deepEqual(plan.conflicts, ['b.txt']); assert.deepEqual(plan.entries, [{ path: 'a.txt', data: 'a' }]);
});
