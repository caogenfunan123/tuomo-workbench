import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBuiltinTools } from '../src/infrastructure/builtin-tools.ts';
import { SessionToolAuthorization, ToolExecutor } from '../src/domain/tools.ts';

test('builtin tools enforce default read-only policy and recoverable delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-tools-')); await writeFile(join(root, 'a.txt'), 'initial'); const tools = createBuiltinTools(root); const read = await tools.executor.execute({ toolId: 'file.read', input: { path: 'a.txt' }, sessionId: 's' }, tools.handlers.get('file.read')!); assert.equal(read, 'initial');
  await assert.rejects(() => tools.executor.execute({ toolId: 'file.write', input: { path: 'a.txt', content: 'x' }, sessionId: 's' }, tools.handlers.get('file.write')!), /authorization required/); const allowed = createBuiltinTools(root, () => true); await allowed.executor.execute({ toolId: 'file.write', input: { path: 'a.txt', content: 'x' }, sessionId: 's' }, allowed.handlers.get('file.write')!); assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'x'); await allowed.executor.execute({ toolId: 'file.delete', input: { path: 'a.txt' }, sessionId: 's' }, allowed.handlers.get('file.delete')!); await assert.rejects(() => readFile(join(root, 'a.txt'), 'utf8'));
});

test('builtin file tools keep symlink targets inside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-tools-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'tuomo-tools-outside-'));
  await writeFile(join(outside, 'secret.txt'), 'outside');
  try {
    await symlink(outside, join(root, 'linked'), 'junction');
  } catch { return; }
  const { executor, handlers } = createBuiltinTools(root, () => true);
  await assert.rejects(() => executor.execute({ toolId: 'file.read', input: { path: 'linked/secret.txt' }, sessionId: 's' }, handlers.get('file.read')!), /escapes workspace/);
});

test('builtin catalog exposes repository, governance and site tools with explicit risk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tuomo-tools-catalog-'));
  await writeFile(join(root, 'config.json'), '{}');
  const tools = createBuiltinTools(root);
  assert.equal(tools.registry.get('repo.list')?.risk, 'read');
  assert.equal(tools.registry.get('git.snapshot')?.risk, 'local-process');
  assert.equal(tools.registry.get('site.provision')?.risk, 'create-repository');
  const files = await tools.executor.execute({ toolId: 'repo.list', input: { path: '' }, sessionId: 'catalog' }, tools.handlers.get('repo.list')!);
  assert.deepEqual(files, ['config.json']);
  await assert.rejects(() => tools.executor.execute({ toolId: 'site.provision', input: { siteId: 'site-a' }, sessionId: 'catalog' }, tools.handlers.get('site.provision')!), /authorization required/);
});

test('builtin authorization grants expire and can be revoked per session', async () => {
  let now = 1_000;
  const tools = createBuiltinTools(await mkdtemp(join(tmpdir(), 'tuomo-tools-auth-')));
  const authorization = new SessionToolAuthorization(() => now);
  const executor = new ToolExecutor(tools.registry, (tool, call) => authorization.authorize(tool, call));
  const call = { toolId: 'file.write', input: { path: 'a.txt', content: 'x' }, sessionId: 'session' };
  await assert.rejects(() => executor.execute(call, tools.handlers.get('file.write')!), /authorization required/);
  authorization.grant('session', 'file.write', 100);
  await executor.execute(call, tools.handlers.get('file.write')!);
  authorization.revoke('session', 'file.write');
  await assert.rejects(() => executor.execute(call, tools.handlers.get('file.write')!), /authorization required/);
  authorization.grant('session', 'file.write', 100); now += 101;
  await assert.rejects(() => executor.execute(call, tools.handlers.get('file.write')!), /authorization required/);
});
