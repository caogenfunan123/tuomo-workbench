import { deflateRawSync, inflateRawSync } from 'node:zlib';

function crc32(data: Uint8Array): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function u16(value: number): Buffer { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value, 0); return buffer; }
function u32(value: number): Buffer { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0, 0); return buffer; }

export function createZip(entries: Array<{ name: string; data: string | Uint8Array; compress?: boolean }>): Uint8Array {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const entry of entries) { const name = Buffer.from(entry.name, 'utf8'); const raw = Buffer.from(entry.data); const compressed = entry.compress ? deflateRawSync(raw) : raw; const method = entry.compress ? 8 : 0; const crc = crc32(raw); const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(compressed.length), u32(raw.length), u16(name.length), u16(0), name, compressed]); locals.push(local); centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(compressed.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name])); offset += local.length; }
  const central = Buffer.concat(centrals); return Buffer.concat([...locals, central, Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)])]);
}

export function readZipEntry(input: Uint8Array, wantedName: string): Uint8Array | undefined {
  const data = Buffer.from(input);
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65_557); offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) return undefined;
  const count = data.readUInt16LE(end + 10);
  let cursor = data.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (data.readUInt32LE(cursor) !== 0x02014b50) return undefined;
    const method = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const uncompressedSize = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localOffset = data.readUInt32LE(cursor + 42);
    if (name === wantedName) {
      if (data.readUInt32LE(localOffset) !== 0x04034b50) return undefined;
      const localNameLength = data.readUInt16LE(localOffset + 26);
      const localExtraLength = data.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = data.subarray(start, start + compressedSize);
      const raw = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : undefined;
      if (!raw || raw.byteLength !== uncompressedSize) return undefined;
      return raw;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}
