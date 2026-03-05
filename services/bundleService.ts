export interface IndividualDocumentBundle {
  id: string;
  title: string;
  url: string;
  source: 'local' | 'online';
  kind: 'photo' | 'document';
  date?: string;
  isPrimaryPhoto?: boolean;
}

export interface LifeThreadBundleMetadata {
  version: '1.0';
  databaseName: string;
  exportedAt: string;
  documentsByIndividualId: Record<string, IndividualDocumentBundle[]>;
}

export async function createLifeThreadBundle(
  gedcomContent: string,
  metadata: LifeThreadBundleMetadata
): Promise<Blob> {
  const zipBytes = buildZipArchive([
    { name: 'tree.ged', content: gedcomContent },
    { name: 'lifethread-metadata.json', content: JSON.stringify(metadata, null, 2) },
  ]);
  const buffer = new ArrayBuffer(zipBytes.byteLength);
  new Uint8Array(buffer).set(zipBytes);
  return new Blob([buffer], { type: 'application/zip' });
}

export async function parseLifeThreadBundle(
  file: File
): Promise<{ gedcomContent: string; metadata: LifeThreadBundleMetadata }> {
  const buffer = await file.arrayBuffer();
  const files = parseZipArchive(buffer);
  const gedcomContent = files['tree.ged'];
  const metadataRaw = files['lifethread-metadata.json'];
  if (!gedcomContent || !metadataRaw) {
    throw new Error('Invalid bundle: tree.ged or lifethread-metadata.json missing');
  }
  const metadata = JSON.parse(metadataRaw) as LifeThreadBundleMetadata;
  return { gedcomContent, metadata };
}

type ZipInputFile = { name: string; content: string };

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  crc32Table = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function buildZipArchive(files: ZipInputFile[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const dataCrc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    writeU32LE(localHeader, 0, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
    writeU16LE(localHeader, 4, 20); // version needed
    writeU16LE(localHeader, 6, 0); // general purpose bit flag
    writeU16LE(localHeader, 8, 0); // compression method (stored)
    writeU16LE(localHeader, 10, 0); // mod time
    writeU16LE(localHeader, 12, 0); // mod date
    writeU32LE(localHeader, 14, dataCrc);
    writeU32LE(localHeader, 18, dataBytes.length);
    writeU32LE(localHeader, 22, dataBytes.length);
    writeU16LE(localHeader, 26, nameBytes.length);
    writeU16LE(localHeader, 28, 0); // extra field length
    localHeader.set(nameBytes, 30);
    localHeader.set(dataBytes, 30 + nameBytes.length);
    localChunks.push(localHeader);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeU32LE(centralHeader, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
    writeU16LE(centralHeader, 4, 20); // version made by
    writeU16LE(centralHeader, 6, 20); // version needed
    writeU16LE(centralHeader, 8, 0); // flags
    writeU16LE(centralHeader, 10, 0); // compression (stored)
    writeU16LE(centralHeader, 12, 0); // mod time
    writeU16LE(centralHeader, 14, 0); // mod date
    writeU32LE(centralHeader, 16, dataCrc);
    writeU32LE(centralHeader, 20, dataBytes.length);
    writeU32LE(centralHeader, 24, dataBytes.length);
    writeU16LE(centralHeader, 28, nameBytes.length);
    writeU16LE(centralHeader, 30, 0); // extra len
    writeU16LE(centralHeader, 32, 0); // comment len
    writeU16LE(centralHeader, 34, 0); // disk number start
    writeU16LE(centralHeader, 36, 0); // internal attrs
    writeU32LE(centralHeader, 38, 0); // external attrs
    writeU32LE(centralHeader, 42, currentOffset);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);

    currentOffset += localHeader.length;
  }

  const centralOffset = currentOffset;
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = new Uint8Array(22);
  writeU32LE(eocd, 0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeU16LE(eocd, 4, 0); // disk number
  writeU16LE(eocd, 6, 0); // central dir start disk
  writeU16LE(eocd, 8, files.length);
  writeU16LE(eocd, 10, files.length);
  writeU32LE(eocd, 12, centralSize);
  writeU32LE(eocd, 16, centralOffset);
  writeU16LE(eocd, 20, 0); // comment length

  const totalLength = localChunks.reduce((sum, chunk) => sum + chunk.length, 0) + centralSize + eocd.length;
  const output = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const chunk of localChunks) {
    output.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  for (const chunk of centralChunks) {
    output.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  output.set(eocd, writeOffset);
  return output;
}

function findEocdOffset(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function parseZipArchive(buffer: ArrayBuffer): Record<string, string> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocdOffset = findEocdOffset(view);
  if (eocdOffset < 0) throw new Error('Invalid zip: EOCD not found');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

  const result: Record<string, string> = {};
  let cdOffset = centralDirectoryOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    const signature = view.getUint32(cdOffset, true);
    if (signature !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid zip: malformed central directory');
    }

    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const fileNameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);

    const nameStart = cdOffset + 46;
    const nameBytes = bytes.slice(nameStart, nameStart + fileNameLen);
    const fileName = decoder.decode(nameBytes);

    const localSig = view.getUint32(localHeaderOffset, true);
    if (localSig !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`Invalid zip: local header missing for ${fileName}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const compressedSize = view.getUint32(localHeaderOffset + 18, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataBytes = bytes.slice(dataOffset, dataOffset + compressedSize);

    if (compressionMethod !== 0) {
      throw new Error(`Unsupported compression method for ${fileName}`);
    }
    result[fileName] = decoder.decode(dataBytes);

    cdOffset += 46 + fileNameLen + extraLen + commentLen;
  }

  return result;
}
