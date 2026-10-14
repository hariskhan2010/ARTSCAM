import { unzlibSync } from 'fflate';

/**
 * WOFF 1.0 → SFNT (TTF/OTF) decoder (W3C WOFF spec §4–5). HarfBuzz reads
 * plain SFNT, and the bundled web fonts ship as WOFF. WOFF2 (Brotli) is not
 * supported; TTF/OTF pass through unchanged.
 */

export class FontFormatError extends Error {
  override name = 'FontFormatError';
}

const u32 = (d: DataView, o: number) => d.getUint32(o, false);
const u16 = (d: DataView, o: number) => d.getUint16(o, false);

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2' | 'collection' | 'unknown';

export function sniffFont(bytes: Uint8Array): FontFormat {
  if (bytes.length < 4) return 'unknown';
  const tag = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'ttcf') return 'collection';
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0))
    return 'ttf';
  return 'unknown';
}

/** Returns SFNT bytes for TTF/OTF/WOFF input. */
export function toSfnt(bytes: Uint8Array): Uint8Array {
  const format = sniffFont(bytes);
  if (format === 'ttf' || format === 'otf' || format === 'collection') return bytes;
  if (format === 'woff2')
    throw new FontFormatError('WOFF2 fonts are not supported; use TTF, OTF or WOFF');
  if (format !== 'woff') throw new FontFormatError('Not a font file (TTF, OTF or WOFF expected)');

  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flavor = u32(d, 4);
  const numTables = u16(d, 12);
  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = u32(d, o);
    const offset = u32(d, o + 4);
    const compLength = u32(d, o + 8);
    const origLength = u32(d, o + 12);
    const checksum = u32(d, o + 16);
    if (offset + compLength > bytes.length) throw new FontFormatError('Truncated WOFF table');
    const raw = bytes.subarray(offset, offset + compLength);
    const data = compLength < origLength ? unzlibSync(raw) : raw;
    if (data.length !== origLength) throw new FontFormatError('Corrupt WOFF table');
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => a.tag - b.tag);

  // SFNT header + directory, then 4-byte aligned tables.
  let size = 12 + 16 * numTables;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const w = new DataView(out.buffer);
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  w.setUint32(0, flavor);
  w.setUint16(4, numTables);
  w.setUint16(6, searchRange);
  w.setUint16(8, entrySelector);
  w.setUint16(10, numTables * 16 - searchRange);
  let offset = 12 + 16 * numTables;
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    w.setUint32(o, t.tag);
    w.setUint32(o + 4, t.checksum);
    w.setUint32(o + 8, offset);
    w.setUint32(o + 12, t.data.length);
    out.set(t.data, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}
