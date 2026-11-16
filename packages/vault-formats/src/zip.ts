/** Minimal zero-dependency ZIP reader & store-mode writer for 1Password .1pux archives. */

const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_ENTRY_SIZE = 128 * 1024 * 1024;
const MAX_ZIP_TOTAL_SIZE = 256 * 1024 * 1024;

interface ZipEntryDescriptor {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

async function inflateRawBytes(compressed: Uint8Array, maxOutputSize: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    const copy = new Uint8Array(compressed.length);
    copy.set(compressed);
    // Write and read concurrently: awaiting the write before reading deadlocks once the output
    // exceeds the stream's internal buffer (backpressure), hanging on larger entries.
    const pump = writer.write(copy).then(() => writer.close());
    pump.catch(() => {});
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > maxOutputSize) {
        await reader.cancel();
        throw new Error("ZIP entry exceeds the maximum supported uncompressed size.");
      }
    }
    await pump;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
  throw new Error("Deflate decompression is not supported in this runtime.");
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/**
 * Entry names are UTF-8 when general-purpose flag bit 11 is set. Legacy archives (CP437/Latin-1
 * names, no flag) are decoded byte-per-char instead of being rejected as invalid UTF-8.
 */
function decodeEntryName(bytes: Uint8Array, flags: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if ((flags & 0x0800) !== 0) throw error;
    return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  }
}

function parseZipEntries(bytes: Uint8Array): ZipEntryDescriptor[] {
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06 &&
      i + 22 + readUint16LE(bytes, i + 20) === bytes.length
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1 || eocdOffset + 22 > bytes.length) {
    throw new Error("Invalid ZIP archive: missing End of Central Directory.");
  }

  const diskNumber = readUint16LE(bytes, eocdOffset + 4);
  const centralDisk = readUint16LE(bytes, eocdOffset + 6);
  const diskEntries = readUint16LE(bytes, eocdOffset + 8);
  const totalEntries = readUint16LE(bytes, eocdOffset + 10);
  const centralSize = readUint32LE(bytes, eocdOffset + 12);
  const centralOffset = readUint32LE(bytes, eocdOffset + 16);
  const commentLength = readUint16LE(bytes, eocdOffset + 20);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    eocdOffset + 22 + commentLength !== bytes.length ||
    totalEntries > MAX_ZIP_ENTRIES ||
    centralOffset + centralSize > eocdOffset
  ) {
    throw new Error("Invalid or unsupported ZIP archive structure.");
  }

  const entries: ZipEntryDescriptor[] = [];
  const names = new Set<string>();
  let pos = centralOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > centralOffset + centralSize || readUint32LE(bytes, pos) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory header.");
    }
    const flags = readUint16LE(bytes, pos + 8);
    const method = readUint16LE(bytes, pos + 10);
    const crc = readUint32LE(bytes, pos + 16);
    const compressedSize = readUint32LE(bytes, pos + 20);
    const uncompressedSize = readUint32LE(bytes, pos + 24);
    const nameLen = readUint16LE(bytes, pos + 28);
    const extraLen = readUint16LE(bytes, pos + 30);
    const commentLen = readUint16LE(bytes, pos + 32);
    const localHeaderOffset = readUint32LE(bytes, pos + 42);
    const nextPos = pos + 46 + nameLen + extraLen + commentLen;
    if (nextPos > centralOffset + centralSize || localHeaderOffset + 30 > bytes.length) {
      throw new Error("Invalid ZIP entry bounds.");
    }
    if ((flags & 1) !== 0 || (flags & 0x40) !== 0) {
      throw new Error("Encrypted ZIP entries are not supported.");
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      uncompressedSize > MAX_ZIP_ENTRY_SIZE ||
      compressedSize > bytes.length
    ) {
      throw new Error("ZIP entry exceeds the maximum supported size.");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_TOTAL_SIZE) {
      throw new Error("ZIP archive exceeds the maximum supported uncompressed size.");
    }

    const name = decodeEntryName(bytes.subarray(pos + 46, pos + 46 + nameLen), flags);
    if (names.has(name)) throw new Error(`Duplicate ZIP entry name: "${name}".`);
    names.add(name);

    const local = localHeaderOffset;
    if (readUint32LE(bytes, local) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for "${name}".`);
    }
    const localFlags = readUint16LE(bytes, local + 6);
    const localMethod = readUint16LE(bytes, local + 8);
    const localNameLen = readUint16LE(bytes, local + 26);
    const localExtraLen = readUint16LE(bytes, local + 28);
    const dataStart = local + 30 + localNameLen + localExtraLen;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      dataStart + compressedSize > centralOffset ||
      decodeEntryName(bytes.subarray(local + 30, local + 30 + localNameLen), localFlags) !== name
    ) {
      throw new Error(`Invalid ZIP entry data bounds for "${name}".`);
    }
    entries.push({ name, method, crc, compressedSize, uncompressedSize, dataStart });
    pos = nextPos;
  }
  if (pos !== centralOffset + centralSize) throw new Error("Invalid ZIP central directory size.");
  return entries;
}

function validateEntryBytes(entry: ZipEntryDescriptor, data: Uint8Array): Uint8Array {
  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) {
    throw new Error(`Corrupt ZIP entry "${entry.name}": size or CRC check failed.`);
  }
  return data;
}

function writeUint16LE(view: DataView, offset: number, val: number): void {
  view.setUint16(offset, val & 0xffff, true);
}

function writeUint32LE(view: DataView, offset: number, val: number): void {
  view.setUint32(offset, val >>> 0, true);
}

/** Synchronously read stored (method 0) entries from a ZIP archive; throws if compressed. */
const syncEntryCache = new WeakMap<Uint8Array, Map<string, Uint8Array>>();

export function readZipEntriesSync(bytes: Uint8Array): Map<string, Uint8Array> {
  // Adapters probe the same archive several times (detect, parse, attributes); inflate it once.
  const cached = syncEntryCache.get(bytes);
  if (cached) return cached;
  const entries = new Map<string, Uint8Array>();
  for (const entry of parseZipEntries(bytes)) {
    const rawSlice = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    if (entry.method === 0) {
      entries.set(entry.name, validateEntryBytes(entry, rawSlice));
    } else if (entry.method === 8) {
      // Try Node/Bun zlib if available synchronously
      const globalRequire = (
        globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }
      ).process?.getBuiltinModule;
      if (typeof globalRequire === "function") {
        const zlib = globalRequire("zlib") as {
          inflateRawSync: (b: Uint8Array, options: { maxOutputLength: number }) => Uint8Array;
        };
        let inflated: Uint8Array;
        try {
          inflated = zlib.inflateRawSync(rawSlice, {
            maxOutputLength: Math.min(entry.uncompressedSize + 1, MAX_ZIP_ENTRY_SIZE),
          });
        } catch {
          throw new Error(`Corrupt ZIP entry "${entry.name}": decompression failed or too large.`);
        }
        entries.set(entry.name, validateEntryBytes(entry, new Uint8Array(inflated)));
      } else {
        throw new Error(`Compressed ZIP entry "${entry.name}" requires async decompression.`);
      }
    } else {
      throw new Error(`Unsupported ZIP compression method ${entry.method} for "${entry.name}".`);
    }
  }

  syncEntryCache.set(bytes, entries);
  return entries;
}

/** Async ZIP reader supporting both Store (0) and Deflate (8) in browsers and Node/Bun. */
export async function readZipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const entries = new Map<string, Uint8Array>();
  for (const entry of parseZipEntries(bytes)) {
    const rawSlice = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    if (entry.method === 0) {
      entries.set(entry.name, validateEntryBytes(entry, rawSlice));
    } else if (entry.method === 8) {
      const inflated = await inflateRawBytes(rawSlice, entry.uncompressedSize);
      entries.set(entry.name, validateEntryBytes(entry, inflated));
    } else {
      throw new Error(`Unsupported ZIP compression method ${entry.method} for "${entry.name}".`);
    }
  }
  return entries;
}

/** Create a valid Store-mode (uncompressed) ZIP archive from named UTF-8/binary entries. */
export function createZipArchive(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  const entries = Object.entries(files);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error("ZIP archive exceeds the maximum supported entry count.");
  }
  let totalUncompressed = 0;
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const dataBytes = typeof content === "string" ? encoder.encode(content) : content;
    totalUncompressed += dataBytes.length;
    if (
      nameBytes.length === 0 ||
      nameBytes.length > 0xffff ||
      dataBytes.length > MAX_ZIP_ENTRY_SIZE ||
      totalUncompressed > MAX_ZIP_TOTAL_SIZE ||
      offset + dataBytes.length + 30 + nameBytes.length > 0xffffffff
    ) {
      throw new Error("ZIP archive exceeds the maximum supported size.");
    }
    const checksum = crc32(dataBytes);

    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    writeUint32LE(lfhView, 0, 0x04034b50);
    writeUint16LE(lfhView, 4, 20); // version needed
    writeUint16LE(lfhView, 6, 0x0800); // UTF-8
    writeUint16LE(lfhView, 8, 0); // store
    writeUint16LE(lfhView, 10, 0);
    writeUint16LE(lfhView, 12, 0);
    writeUint32LE(lfhView, 14, checksum);
    writeUint32LE(lfhView, 18, dataBytes.length);
    writeUint32LE(lfhView, 22, dataBytes.length);
    writeUint16LE(lfhView, 26, nameBytes.length);
    writeUint16LE(lfhView, 28, 0);
    lfh.set(nameBytes, 30);

    localParts.push(lfh, dataBytes);

    const cdh = new Uint8Array(46 + nameBytes.length);
    const cdhView = new DataView(cdh.buffer);
    writeUint32LE(cdhView, 0, 0x02014b50);
    writeUint16LE(cdhView, 4, 20);
    writeUint16LE(cdhView, 6, 20);
    writeUint16LE(cdhView, 8, 0x0800);
    writeUint16LE(cdhView, 10, 0);
    writeUint16LE(cdhView, 12, 0);
    writeUint16LE(cdhView, 14, 0);
    writeUint32LE(cdhView, 16, checksum);
    writeUint32LE(cdhView, 20, dataBytes.length);
    writeUint32LE(cdhView, 24, dataBytes.length);
    writeUint16LE(cdhView, 28, nameBytes.length);
    writeUint16LE(cdhView, 30, 0);
    writeUint16LE(cdhView, 32, 0);
    writeUint16LE(cdhView, 34, 0);
    writeUint16LE(cdhView, 36, 0);
    writeUint32LE(cdhView, 38, 0);
    writeUint32LE(cdhView, 42, offset);
    cdh.set(nameBytes, 46);

    cdParts.push(cdh);
    offset += lfh.length + dataBytes.length;
  }

  const cdSize = cdParts.reduce((sum, p) => sum + p.length, 0);
  if (offset + cdSize > 0xffffffff || entries.length > 0xffff) {
    throw new Error("ZIP archive exceeds the maximum supported ZIP32 size.");
  }
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeUint32LE(eocdView, 0, 0x06054b50);
  writeUint16LE(eocdView, 4, 0);
  writeUint16LE(eocdView, 6, 0);
  writeUint16LE(eocdView, 8, entries.length);
  writeUint16LE(eocdView, 10, entries.length);
  writeUint32LE(eocdView, 12, cdSize);
  writeUint32LE(eocdView, 16, offset);
  writeUint16LE(eocdView, 20, 0);

  const totalSize = offset + cdSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let cursor = 0;
  for (const p of [...localParts, ...cdParts, eocd]) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}
