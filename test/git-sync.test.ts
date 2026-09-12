import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticSite } from '../src/domain/site.ts';
import { SafeRelativePath } from '../src/domain/values.ts';
import { GitSyncTransport } from '../src/infrastructure/git-sync-transport.ts';
import { InMemoryStaticPublishGateway } from '../src/infrastructure/memory-gateways.ts';

test('Git sync transport persists manifest and versioned objects through static gateway', async () => { const site = createStaticSite({ id: 'sync', name: 'sync', kind: 'static', isDefault: true, config: { provider: 'generic', repository: 'r', branch: 'main', postPath: SafeRelativePath.parse('posts'), pagePath: SafeRelativePath.parse('pages'), framework: 'hexo', publishTimeZoneOffsetMinutes: 480, mirrors: [], hooks: [] } }); const gateway = new InMemoryStaticPublishGateway(); const transport = new GitSyncTransport(gateway, site); await transport.push({ 'article:a': { payload: 'body', revision: 1, hash: 'h', modifiedAt: '' } }); await transport.push({ 'article:b': { payload: 'second', revision: 1, hash: 'h2', modifiedAt: '' } }); const pulled = await transport.pull(); assert.equal(pulled.objects['article:a'].payload, 'body'); assert.equal(pulled.objects['article:b'].payload, 'second'); });
