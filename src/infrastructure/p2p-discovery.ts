import { createHash } from 'node:crypto';
import * as dgram from 'node:dgram';
import { DomainError } from '../domain/errors.ts';

export type DiscoveredDevice = { deviceId: string; address: string; port: number; fingerprint: string; expiresAt: number };
export type DiscoveryAnnouncement = { type: 'tuomo-pair'; deviceId: string; port: number; publicKey: string; fingerprint: string; expiresAt: number };

export class P2PDiscoveryService {
  private readonly socket = dgram.createSocket('udp4');
  private readonly devices = new Map<string, DiscoveredDevice>();
  private readonly port: number;
  private open = false;
  constructor(port = 38_721) { if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new DomainError('validation', 'Discovery port is invalid'); this.port = port; this.socket.on('message', (message, remote) => { try { const value = JSON.parse(message.toString('utf8')) as DiscoveryAnnouncement; if (value.type !== 'tuomo-pair' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.deviceId) || !value.publicKey || !Number.isInteger(value.port) || value.port < 1 || value.port > 65_535 || value.expiresAt <= Date.now()) return; const fingerprint = createHash('sha256').update(value.publicKey).digest('hex').slice(0, 16); if (fingerprint !== value.fingerprint) return; this.devices.set(value.deviceId, { deviceId: value.deviceId, address: remote.address, port: value.port, fingerprint, expiresAt: value.expiresAt }); } catch { /* ignore malformed broadcast */ } }); }
  async start(): Promise<void> { if (this.open) return; await new Promise<void>((resolve, reject) => { this.socket.once('error', reject); this.socket.bind(this.port, '0.0.0.0', () => { this.open = true; this.socket.setBroadcast(true); resolve(); }); }); }
  async announce(value: Omit<DiscoveryAnnouncement, 'type'>, broadcastAddress = '255.255.255.255'): Promise<void> { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value.deviceId) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65_535 || value.expiresAt <= Date.now()) throw new DomainError('validation', 'Discovery announcement is invalid or expired'); const payload = Buffer.from(JSON.stringify({ type: 'tuomo-pair', ...value })); await new Promise<void>((resolve, reject) => this.socket.send(payload, this.port, broadcastAddress, (error) => error ? reject(error) : resolve())); this.open = true; }
  list(now = Date.now()): DiscoveredDevice[] { for (const [id, device] of this.devices) if (device.expiresAt <= now) this.devices.delete(id); return [...this.devices.values()].map((device) => ({ ...device })); }
  async close(): Promise<void> { if (!this.open) return; await new Promise<void>((resolve) => this.socket.close(() => resolve())); this.open = false; }
}
