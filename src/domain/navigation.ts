export type FeatureEntry = { id: string; capability: string; route: string; section: 'writing' | 'publishing' | 'sites' | 'data' | 'ai' | 'system'; highFrequency: boolean; standardOnly?: boolean };

export const FEATURE_ENTRIES: FeatureEntry[] = [
  ['home','HOME','/','writing',true], ['drafts','W05','/drafts','writing',true], ['editor','W01-W04','/editor','writing',true], ['reading','W06','/reading','writing',false], ['templates','W07','/templates','writing',false], ['snippets','W07','/snippets','writing',false], ['search','W07','/search','writing',false], ['writing-stats','W07','/writing-stats','writing',false], ['platform-experience','W10','/writing/platform','writing',false],
  ['static-posts','P05','/publish/static','publishing',true], ['remote-posts','P06-P07','/publish/remote','publishing',false], ['batch-publish','P04','/publish/batch','publishing',false], ['history','P05','/publish/history','publishing',false], ['preview','P03','/publish/preview','publishing',false],
  ['sites','P01-P10','/sites','sites',true], ['cms','P06','/sites/cms','sites',false], ['site-wizard','P09','/sites/new','sites',false], ['site-health','P10','/sites/health','sites',false],
  ['sync','S01-S04','/data/sync','data',true], ['versions','W08','/data/versions','data',false], ['trash','W08','/data/trash','data',false], ['backup','S05-S07','/data/backup','data',false], ['file-area','W09','/data/files','data',false],
  ['ai-actions','A01-A03','/ai/actions','ai',true], ['agent','A04-A05','/ai/agent','ai',false], ['models','A02-A03','/ai/models','ai',false], ['tools','A05-A08','/ai/tools','ai',false], ['mcp','A06','/ai/mcp','ai',false], ['theme-migration','A07','/ai/themes','ai',false],
  ['image-hosting','U02','/tools/images','system',true], ['rss','U01','/tools/rss','system',false], ['batch-tools','U03-U04','/tools/batch','system',false], ['settings','U05','/settings','system',true], ['logs','S07','/settings/logs','system',false], ['updates','S07','/settings/updates','system',false], ['appearance','U05','/settings/appearance','system',false],
].map(([id, capability, route, section, highFrequency]) => ({ id, capability, route, section: section as FeatureEntry['section'], highFrequency }));

export const ALL_CAPABILITIES = [...'WPSAU'.split('').flatMap((prefix) => Array.from({ length: prefix === 'W' ? 10 : prefix === 'P' ? 10 : prefix === 'S' ? 7 : prefix === 'A' ? 8 : 5 }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`))];
export function expandCapabilities(capability: string): string[] { const range = /^(\w)(\d{2})-(\w)?(\d{2})$/.exec(capability); if (!range) return capability.match(/^[WPSAU]\d{2}$/) ? [capability] : []; const prefix = range[1]; const start = Number(range[2]); const end = Number(range[4]); return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${String(start + index).padStart(2, '0')}`); }
export function coveredCapabilities(): string[] { return [...new Set(FEATURE_ENTRIES.flatMap((entry) => expandCapabilities(entry.capability)))].sort(); }
export function missingCapabilities(): string[] { const covered = new Set(coveredCapabilities()); return ALL_CAPABILITIES.filter((capability) => !covered.has(capability)); }

export function featureFromRoute(route: string): FeatureEntry | undefined {
  const normalized = route.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  return FEATURE_ENTRIES.find((entry) => entry.route === normalized);
}

export function visibleFeatures(mode: 'simple' | 'standard', pinned: string[] = []): FeatureEntry[] {
  const entries = FEATURE_ENTRIES.filter((entry) => mode === 'standard' || entry.highFrequency || pinned.includes(entry.id));
  return [...entries].sort((a, b) => Number(b.highFrequency) - Number(a.highFrequency));
}
