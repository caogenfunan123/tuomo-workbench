import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import { SafeRelativePath } from '../domain/values.ts';
import { SessionToolAuthorization, ToolRegistry, ToolExecutor } from '../domain/tools.ts';
import type { ToolCall } from '../domain/tools.ts';
import { HttpJsonClient } from './http-client.ts';

export type BuiltinToolExtensions = {
  webSearch?: (query: string) => Promise<unknown>;
  gitSnapshot?: (message: string) => Promise<unknown>;
  gitRollback?: (revision: string) => Promise<unknown>;
  listTemplates?: () => Promise<unknown>;
  listSkills?: () => Promise<unknown>;
  validateSite?: (siteId: string) => Promise<unknown>;
  provisionSite?: (siteId: string) => Promise<unknown>;
  deploySite?: (siteId: string) => Promise<unknown>;
};
export type BuiltinTools = { registry: ToolRegistry; executor: ToolExecutor; handlers: Map<string, (call: ToolCall) => Promise<unknown>>; authorization: SessionToolAuthorization };
export function createBuiltinTools(root: string, authorize?: (tool: any, call: ToolCall) => Promise<boolean> | boolean, extensions: BuiltinToolExtensions = {}): BuiltinTools {
  const registry = new ToolRegistry(); const handlers = new Map<string, (call: ToolCall) => Promise<unknown>>();
  const http = new HttpJsonClient();
  const authorization = new SessionToolAuthorization();
  registry.register({ id: 'file.read', kind: 'file', scope: 'global', params: { path: 'safe-path' }, risk: 'read', enabled: true }); handlers.set('file.read', async (call) => fs.readFile(await safeTarget(root, String(call.input.path)), 'utf8'));
  registry.register({ id: 'file.write', kind: 'file', scope: 'global', params: { path: 'safe-path', content: 'string' }, risk: 'external-write', enabled: true }); handlers.set('file.write', async (call) => { const path = await safeTarget(root, String(call.input.path), true); await fs.writeFile(path, String(call.input.content)); return { path: call.input.path, bytes: Buffer.byteLength(String(call.input.content)) }; });
  registry.register({ id: 'file.delete', kind: 'file', scope: 'global', params: { path: 'safe-path' }, risk: 'delete', enabled: true }); handlers.set('file.delete', async (call) => { const safe = SafeRelativePath.parse(String(call.input.path)); const path = await safeTarget(root, safe.value); try { await fs.mkdir(join(resolve(root), 'trash'), { recursive: true }); await fs.rename(path, join(resolve(root), 'trash', `${Date.now()}-${safe.value.replaceAll('/', '_')}`)); return { deleted: safe.value, recoverable: true }; } catch (error: any) { if (error.code === 'ENOENT') throw new DomainError('notFound', `File not found: ${safe.value}`); throw error; } });
  registry.register({ id: 'repo.list', kind: 'repository', scope: 'global', params: { path: 'string' }, risk: 'read', enabled: true }); handlers.set('repo.list', async (call) => listRepositoryFiles(root, String(call.input.path)));
  registry.register({ id: 'config.read', kind: 'configuration', scope: 'global', params: { path: 'safe-path' }, risk: 'read', enabled: true }); handlers.set('config.read', async (call) => fs.readFile(await safeTarget(root, String(call.input.path)), 'utf8'));
  registry.register({ id: 'web.fetch', kind: 'web', scope: 'global', params: { url: 'string' }, risk: 'external-read', enabled: true }); handlers.set('web.fetch', async (call) => { const url = new URL(String(call.input.url)); if (!['http:', 'https:'].includes(url.protocol)) throw new DomainError('security', 'Only HTTP(S) URLs are allowed'); const response = await http.requestText(url.toString(), {}, { timeoutMs: 15_000, retries: 2, signal: call.signal }); return { status: response.status, body: response.body.slice(0, 100_000), requestId: response.requestId }; });
  registry.register({ id: 'web.search', kind: 'web', scope: 'global', params: { query: 'string' }, risk: 'external-read', enabled: true }); handlers.set('web.search', async (call) => configured('web.search', extensions.webSearch, String(call.input.query)));
  registry.register({ id: 'git.snapshot', kind: 'git', scope: 'global', params: { message: 'string' }, risk: 'local-process', enabled: true }); handlers.set('git.snapshot', async (call) => configured('git.snapshot', extensions.gitSnapshot, String(call.input.message)));
  registry.register({ id: 'git.rollback', kind: 'git', scope: 'global', params: { revision: 'string' }, risk: 'local-process', enabled: true }); handlers.set('git.rollback', async (call) => configured('git.rollback', extensions.gitRollback, String(call.input.revision)));
  registry.register({ id: 'template.list', kind: 'template', scope: 'global', params: {}, risk: 'read', enabled: true }); handlers.set('template.list', async () => configured('template.list', extensions.listTemplates));
  registry.register({ id: 'skill.list', kind: 'skill', scope: 'global', params: {}, risk: 'read', enabled: true }); handlers.set('skill.list', async () => configured('skill.list', extensions.listSkills));
  registry.register({ id: 'site.validate', kind: 'site', scope: 'global', params: { siteId: 'string' }, risk: 'external-read', enabled: true }); handlers.set('site.validate', async (call) => configured('site.validate', extensions.validateSite, String(call.input.siteId)));
  registry.register({ id: 'site.provision', kind: 'site', scope: 'global', params: { siteId: 'string' }, risk: 'create-repository', enabled: true }); handlers.set('site.provision', async (call) => configured('site.provision', extensions.provisionSite, String(call.input.siteId)));
  registry.register({ id: 'deploy.trigger', kind: 'deployment', scope: 'global', params: { siteId: 'string' }, risk: 'deploy', enabled: true }); handlers.set('deploy.trigger', async (call) => configured('deploy.trigger', extensions.deploySite, String(call.input.siteId)));
  const executor = new ToolExecutor(registry, authorize ?? ((tool, call) => authorization.authorize(tool, call))); return { registry, executor, handlers, authorization };
}

async function configured<T>(name: string, handler: ((value?: string) => Promise<T>) | undefined, value?: string): Promise<T> {
  if (!handler) throw new DomainError('unsupported', `${name} gateway is not configured`);
  return handler(value);
}

async function listRepositoryFiles(root: string, input: string): Promise<string[]> {
  const start = input.trim() ? SafeRelativePath.parse(input).value : '';
  const base = start ? await safeTarget(root, start) : resolve(root);
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relativePath = relative(resolve(root), absolute).replaceAll('\\', '/');
      SafeRelativePath.parse(relativePath);
      if (entry.isSymbolicLink()) {
        await safeTarget(root, relativePath);
        continue;
      }
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(relativePath);
    }
  };
  await visit(base);
  return files.sort();
}

async function safeTarget(root: string, input: string, createParent = false): Promise<string> {
  const safe = SafeRelativePath.parse(input);
  const rootPath = resolve(root);
  await fs.mkdir(rootPath, { recursive: true });
  const realRoot = await fs.realpath(rootPath);
  const target = resolve(realRoot, safe.value);
  ensureWithin(realRoot, target);
  if (createParent) await fs.mkdir(dirname(target), { recursive: true });
  const realParent = await fs.realpath(dirname(target));
  ensureWithin(realRoot, realParent);
  try { ensureWithin(realRoot, await fs.realpath(target)); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  return target;
}

function ensureWithin(root: string, target: string): void { const value = relative(root, target); if (value === '..' || value.startsWith(`..${requireSeparator()}`) || isAbsolute(value)) throw new DomainError('security', 'File path escapes workspace root'); }
function requireSeparator(): string { return process.platform === 'win32' ? '\\' : '/'; }
