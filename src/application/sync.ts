import { DomainError } from '../domain/errors.ts';
import { compareSync } from '../domain/sync.ts';
import type { Manifest, SyncConflict, SyncObject } from '../domain/sync.ts';
import { contentHash } from '../domain/values.ts';
import type { AuditStore, GatewayRequestOptions, SyncTransport } from './ports.ts';

export type SyncItem = { key: string; status: ReturnType<typeof compareSync>; local?: SyncObject; remote?: SyncObject };
export type SyncReport = { pushed: string[]; pulled: string[]; conflicts: SyncConflict[]; missing: string[] };
export type ConflictChoice = 'local' | 'remote' | 'merged';
export type ConflictDecision = { key: string; choice: ConflictChoice; payload?: string };
export type ResolvedSync = { object: SyncObject; payload: string };

export class SyncUseCase {
  private readonly transport: SyncTransport;
  private readonly audit?: AuditStore;
  constructor(transport: SyncTransport, audit?: AuditStore) { this.transport = transport; this.audit = audit; }

  compare(local: Manifest, remote: Manifest): SyncItem[] {
    const keys = new Set([...local.objects.map((object) => `${object.objectType}:${object.objectId}`), ...remote.objects.map((object) => `${object.objectType}:${object.objectId}`)]);
    return [...keys].map((key) => {
      const [objectType, objectId] = key.split(':');
      const localObject = local.objects.find((object) => object.objectType === objectType && object.objectId === objectId);
      const remoteObject = remote.objects.find((object) => object.objectType === objectType && object.objectId === objectId);
      return { key, status: compareSync(localObject, remoteObject), local: localObject, remote: remoteObject };
    });
  }

  async push(local: Manifest, payloads: Record<string, string>, options: GatewayRequestOptions = {}): Promise<void> {
    const objects: Record<string, { payload: string; revision: number; hash: string; modifiedAt: string }> = {};
    for (const object of local.objects) {
      const key = `${object.objectType}:${object.objectId}`;
      const payload = payloads[key];
      if (payload === undefined) continue;
      objects[key] = { payload, revision: object.revision, hash: object.hash, modifiedAt: object.modifiedAt };
    }
    await this.transport.push(objects, options);
    await this.audit?.append({ action: 'sync.push', details: { objectCount: Object.keys(objects).length } });
  }

  async pull(local: Manifest, payloads: Record<string, string>, options: GatewayRequestOptions = {}): Promise<{ report: SyncReport; payloads: Record<string, string> }> {
    const remote = await this.transport.pull(options);
    const remoteObjects: SyncObject[] = Object.entries(remote.objects).map(([key, object]) => { const [objectType, objectId] = key.split(':'); return { objectType: objectType as SyncObject['objectType'], objectId, revision: object.revision, hash: object.hash, modifiedAt: object.modifiedAt, originDeviceId: 'remote' }; });
    const remoteManifest: Manifest = { deviceId: 'remote', objects: remoteObjects, updatedAt: new Date().toISOString() };
    const items = this.compare(local, remoteManifest);
    const report: SyncReport = { pushed: [], pulled: [], conflicts: [], missing: [] };
    const merged = { ...payloads };
    for (const item of items) {
      if (item.status === 'pullRequired' || (!item.local && item.remote)) { report.pulled.push(item.key); if (remote.objects[item.key]) merged[item.key] = remote.objects[item.key].payload; }
      else if (item.status === 'conflict') report.conflicts.push({ object: item.remote ?? item.local!, local: item.local, remote: item.remote });
      else if (item.status === 'missing') report.missing.push(item.key);
    }
    await this.audit?.append({ action: 'sync.pull', details: { pulled: report.pulled.length, conflicts: report.conflicts.length } });
    return { report, payloads: merged };
  }

  resolveConflict(conflict: SyncConflict, payloads: Record<string, string>, decision: ConflictDecision): ResolvedSync {
    const key = `${conflict.object.objectType}:${conflict.object.objectId}`;
    if (decision.key !== key) throw new DomainError('validation', `Conflict decision does not match ${key}`);
    const localPayload = conflict.local ? payloads[key] : undefined;
    const remotePayload = conflict.remote ? payloads[`${key}@remote`] : undefined;
    let payload: string | undefined;
    if (decision.choice === 'local') payload = localPayload;
    else if (decision.choice === 'remote') payload = remotePayload;
    else payload = decision.payload;
    if (payload === undefined) throw new DomainError('validation', `Missing payload for conflict decision: ${key}`);
    const source = decision.choice === 'remote' ? conflict.remote : conflict.local;
    const revision = decision.choice === 'merged' ? Math.max(conflict.local?.revision ?? 0, conflict.remote?.revision ?? 0) + 1 : source?.revision ?? conflict.object.revision;
    return { object: { ...(source ?? conflict.object), revision, hash: contentHash(payload), modifiedAt: new Date().toISOString() }, payload };
  }

  async resolveConflicts(local: Manifest, pulled: { report: SyncReport; payloads: Record<string, string> }, decisions: ConflictDecision[], remotePayloads: Record<string, string>): Promise<{ manifest: Manifest; payloads: Record<string, string>; resolved: string[] }> {
    const decisionMap = new Map(decisions.map((decision) => [decision.key, decision]));
    const payloads = { ...pulled.payloads };
    const objects = new Map(local.objects.map((object) => [`${object.objectType}:${object.objectId}`, object]));
    const resolved: string[] = [];
    for (const conflict of pulled.report.conflicts) {
      const key = `${conflict.object.objectType}:${conflict.object.objectId}`;
      const decision = decisionMap.get(key);
      if (!decision) throw new DomainError('validation', `Unresolved sync conflict: ${key}`);
      const localPayload = payloads[key];
      if (localPayload !== undefined) payloads[key] = localPayload;
      const resolvedValue = this.resolveConflict(conflict, { ...payloads, [`${key}@remote`]: remotePayloads[key] }, decision);
      payloads[key] = resolvedValue.payload;
      objects.set(key, { ...resolvedValue.object, originDeviceId: local.deviceId });
      resolved.push(key);
    }
    return { manifest: { deviceId: local.deviceId, objects: [...objects.values()], cursor: local.cursor, updatedAt: new Date().toISOString() }, payloads, resolved };
  }

  static object(objectType: SyncObject['objectType'], objectId: string, payload: string, revision: number, deviceId: string, modifiedAt = new Date().toISOString()): SyncObject {
    if (!payload) throw new DomainError('validation', 'Sync payload cannot be empty');
    return { objectType, objectId, payload, revision, hash: contentHash(payload), modifiedAt, originDeviceId: deviceId } as SyncObject & { payload: string };
  }
}
