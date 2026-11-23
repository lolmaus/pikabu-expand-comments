import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { deflateRawSync } from "node:zlib";

export interface ZipEntryInput {
  path: string;
  data: Buffer;
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let bit = 0; bit < 8; bit += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed DOS date/time: 1980-01-01 00:00:00 UTC for byte-for-byte reproducible ZIPs.
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
// Normalized UNIX file mode 0100644 shifted into external file attributes.
const NORMALIZED_EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

export function createDeterministicZip(entries: readonly ZipEntryInput[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBytes = Buffer.from(entry.path, "utf8");
    const uncompressed = entry.data;
    const compressed = deflateRawSync(uncompressed, { level: 9 });
    const useDeflate = compressed.length < uncompressed.length;
    const payload = useDeflate ? compressed : uncompressed;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed: 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(FIXED_DOS_TIME, 10);
    localHeader.writeUInt16LE(FIXED_DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBytes, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central file header signature
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // version made by: Unix, 2.0
    centralHeader.writeUInt16LE(20, 6); // version needed: 2.0
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(FIXED_DOS_TIME, 12);
    centralHeader.writeUInt16LE(FIXED_DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(NORMALIZED_EXTERNAL_ATTRS, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  endRecord.writeUInt16LE(0, 4); // disk number
  endRecord.writeUInt16LE(0, 6); // central dir disk
  endRecord.writeUInt16LE(sorted.length, 8);
  endRecord.writeUInt16LE(sorted.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

export function collectDirectoryZipEntries(dir: string, prefix = ""): ZipEntryInput[] {
  const entries: ZipEntryInput[] = [];
  for (const name of readdirSync(dir).sort()) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    const relPath = prefix ? posix.join(prefix, name) : name;
    if (stat.isDirectory()) {
      entries.push(...collectDirectoryZipEntries(fullPath, relPath));
    } else if (stat.isFile()) {
      entries.push({ path: relPath, data: readFileSync(fullPath) });
    }
  }
  return entries;
}

export function writeDeterministicZipFromDir(sourceDir: string, destinationZip: string): void {
  const entries = collectDirectoryZipEntries(sourceDir);
  writeFileSync(destinationZip, createDeterministicZip(entries));
}
