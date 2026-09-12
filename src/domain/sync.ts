import type { SiteId } from './values.ts';

export type SyncObject = {
  objectType: 'article' | 'settings' | 'template' | 'snippet' | 'mapping';
  objectId: string;
  revision: number;
  hash: string;
  modifiedAt: string;
  originDeviceId: string;
};

export type SyncComparison = 'inSync' | 'pushRequired' | 'pullRequired' | 'conflict' | 'missing';

export type SyncConflict = {
  object: SyncObject;
  local?: SyncObject;
  remote?: SyncObject;
  base?: SyncObject;
};

export function compareSync(local: SyncObject | undefined, remote: SyncObject | undefined, base?: SyncObject): SyncComparison {
  if (!local && !remote) return 'inSync';
  if (!local || !remote) return 'missing';
  if (local.hash === remote.hash) return 'inSync';
  if (base && local.hash !== base.hash && remote.hash !== base.hash) return 'conflict';
  if (local.revision > remote.revision) return 'pushRequired';
  if (remote.revision > local.revision) return 'pullRequired';
  return 'conflict';
}

export type Manifest = { deviceId: string; objects: SyncObject[]; cursor?: string; updatedAt: string };

export type BindingKey = `${SiteId}:${string}`;

export function bindingKey(siteId: SiteId, articleId: string): BindingKey { return `${siteId}:${articleId}` as BindingKey; }
