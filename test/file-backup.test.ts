import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileBackupUseCase } from '../src/infrastructure/file-backup.ts';
import { createBackup } from '../src/application/backup.ts';

test('file backup creates a preview and restores only non-conflicting safe files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-backup-')); await mkdir(join(root, 'articles')); await writeFile(join(root, 'articles', 'a.md'), 'a'); const useCase = new FileBackupUseCase(); const archive = await useCase.export(root, ['articles']); const target = await mkdtemp(join(tmpdir(), 'tuomo-restore-')); await mkdir(join(target, 'articles')); await writeFile(join(target, 'articles', 'a.md'), 'existing'); const plan = await useCase.restore(target, archive); assert.deepEqual(plan.conflicts, ['articles/a.md']); assert.equal(await readFile(join(target, 'articles', 'a.md'), 'utf8'), 'existing');
});

test('file restore refuses symlinked destination parents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-restore-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'tuomo-restore-outside-'));
  await symlink(outside, join(root, 'linked'), 'junction');
  const archive = createBackup([{ path: 'linked/escape.txt', data: 'secret' }]);
  await assert.rejects(() => new FileBackupUseCase().restore(root, archive), /escapes backup root/);
  await assert.rejects(() => readFile(join(outside, 'escape.txt'), 'utf8'));
});
