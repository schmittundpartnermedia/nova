import { inflateRawSync, deflateRawSync } from "node:zlib";

type ZipEntry = {
  name: string;
  data: Buffer;
  directory: boolean;
};

function readU16(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

export type ZipIndexEntry = {
  name: string;
  directory: boolean;
  method: number;
  compressed: number;
  uncompressed: number;
  localOffset: number;
};

function findEocd(bytes: Buffer): number {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

export function listZipEntries(bytes: Buffer): ZipIndexEntry[] {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error("Kein gültiges ZIP-Archiv.");
  const count = readU16(bytes, eocd + 10);
  let offset = readU32(bytes, eocd + 16);
  const entries: ZipIndexEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (readU32(bytes, offset) !== 0x02014b50) break;
    const method = readU16(bytes, offset + 10);
    const compressed = readU32(bytes, offset + 20);
    const uncompressed = readU32(bytes, offset + 24);
    const nameLen = readU16(bytes, offset + 28);
    const extraLen = readU16(bytes, offset + 30);
    const commentLen = readU16(bytes, offset + 32);
    const localOffset = readU32(bytes, offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    entries.push({
      name,
      directory: name.endsWith("/"),
      method,
      compressed,
      uncompressed,
      localOffset,
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(bytes: Buffer, entry: ZipIndexEntry): Buffer {
  const nameLen = readU16(bytes, entry.localOffset + 26);
  const extraLen = readU16(bytes, entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const payload = bytes.subarray(dataStart, dataStart + entry.compressed);
  if (entry.directory) return Buffer.alloc(0);
  if (entry.method === 0) return Buffer.from(payload.subarray(0, entry.uncompressed || payload.length));
  if (entry.method === 8) return Buffer.from(inflateRawSync(payload));
  throw new Error(`Nicht unterstützte ZIP-Kompression (${entry.method}) in ${entry.name}`);
}

export function readZipEntryByName(bytes: Buffer, name: string): Buffer | null {
  const needle = name.replace(/^\/+/, "").toLowerCase();
  const entry = listZipEntries(bytes).find((item) => {
    const current = item.name.replace(/^\/+/, "").toLowerCase();
    return current === needle || current.endsWith(`/${needle}`);
  });
  if (!entry || entry.directory) return null;
  return readZipEntry(bytes, entry);
}

export function unzipSync(bytes: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Kein gültiges ZIP-Archiv.");
  const count = readU16(bytes, eocd + 10);
  let offset = readU32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (readU32(bytes, offset) !== 0x02014b50) break;
    const method = readU16(bytes, offset + 10);
    const compressed = readU32(bytes, offset + 20);
    const uncompressed = readU32(bytes, offset + 24);
    const nameLen = readU16(bytes, offset + 28);
    const extraLen = readU16(bytes, offset + 30);
    const commentLen = readU16(bytes, offset + 32);
    const localOffset = readU32(bytes, offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    const dataStart = localOffset + 30 + readU16(bytes, localOffset + 26) + readU16(bytes, localOffset + 28);
    const payload = bytes.subarray(dataStart, dataStart + compressed);
    let data = Buffer.alloc(0);
    if (!name.endsWith("/")) {
      if (method === 0) data = Buffer.from(payload);
      else if (method === 8) data = Buffer.from(inflateRawSync(payload));
      else throw new Error(`Nicht unterstützte ZIP-Kompression (${method}) in ${name}`);
      if (uncompressed && data.length !== uncompressed && method === 0) {
        data = data.subarray(0, uncompressed);
      }
    }
    entries.push({ name, data, directory: name.endsWith("/") });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function zipStore(files: Array<{ name: string; data: Buffer | string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = typeof file.data === "string" ? Buffer.from(file.data, "utf8") : file.data;
    const compressed = Buffer.from(deflateRawSync(data));
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    compressed.copy(local, 30 + name.length);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(0, 36);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
