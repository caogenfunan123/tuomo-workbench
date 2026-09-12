import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticle } from '../src/domain/article.ts';
import { createCmsSite } from '../src/domain/site.ts';
import { InMemoryCmsPostGateway } from '../src/infrastructure/memory-gateways.ts';
import { JsonArticleRepository } from '../src/infrastructure/json-article-repository.ts';
import { InMemoryBindingStore } from '../src/infrastructure/memory-stores.ts';
import { CmsSyncUseCase, threeWayMerge } from '../src/application/cms-sync.ts';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('three-way CMS sync distinguishes clean changes from conflicts', () => { assert.deepEqual(threeWayMerge('base', 'local', 'base'), { clean: true, content: 'local' }); const conflict = threeWayMerge('base', 'local', 'remote'); assert.equal(conflict.clean, false); assert.match(conflict.content, /<<<<<<< LOCAL/); });

test('CMS sync compares a remote binding and resolves remote content', async () => { const root = await mkdtemp(join(tmpdir(), 'tuomo-cms-sync-')); const repo = new JsonArticleRepository(root); const article = createArticle({ id: 'a', title: 'Local', body: 'Body' }); await repo.put(article, 0); const bindings = new InMemoryBindingStore(); const gateway = new InMemoryCmsPostGateway(); const site = createCmsSite({ id: 'cms', name: 'cms', kind: 'cms', isDefault: true, config: { cmsKind: 'wordpress', baseUrl: 'https://cms.test', ignoreSsl: false, adapterOptions: {} } }); const remote = await gateway.create(site, { title: 'Remote', markdown: 'Remote body', tags: [], categories: [], status: 'draft', date: '' }); await bindings.put({ siteId: site.id, articleId: 'a', remoteId: remote.id, remoteRevision: remote.revision, baseContentHash: 'old', syncedAt: '' }); const sync = new CmsSyncUseCase(repo, gateway, bindings); const comparison = await sync.compare('a', site, remote); assert.equal(comparison.state, 'conflict'); const resolved = await sync.resolve(comparison, site, 'remote'); assert.equal(resolved.title, 'Remote'); });
