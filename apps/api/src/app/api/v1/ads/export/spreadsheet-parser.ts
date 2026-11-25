import zlib from 'node:zlib';
import { logServerEvent, summarizeError } from '../../../../../core/logging/logger';

const MAX_ZIP_ENTRIES = 200;
const MAX_ZIP_ENTRY_INFLATED_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_TOTAL_INFLATED_BYTES = 25 * 1024 * 1024;

export function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function letterToColIndex(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

export function extractAllowedGoogleSheetExportUrl(rawUrl: string): string | null {
  const trimmed = (rawUrl || '').trim();
  const match = trimmed.match(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:[/?#].*)?$/i,
  );
  if (!match || !match[1]) return null;
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
}

export function extractZipEntries(buf: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let offset = 0;
  let totalInflatedBytes = 0;
  while (offset + 30 <= buf.length && entries.size < MAX_ZIP_ENTRIES) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    if ((flags & 0x08) !== 0 && compSize === 0) break;
    if (uncompSize > MAX_ZIP_ENTRY_INFLATED_BYTES) {
      throw new Error('Tệp Excel giải nén vượt quá giới hạn an toàn (ZIP bomb protection).');
    }
    const compData = buf.subarray(dataStart, dataStart + compSize);
    try {
      if (method === 0) {
        totalInflatedBytes += compData.length;
        if (totalInflatedBytes > MAX_ZIP_TOTAL_INFLATED_BYTES) break;
        entries.set(name, compData.toString('utf8'));
      } else if (method === 8) {
        const inflated = zlib.inflateRawSync(compData, { maxOutputLength: MAX_ZIP_ENTRY_INFLATED_BYTES });
        totalInflatedBytes += inflated.length;
        if (totalInflatedBytes > MAX_ZIP_TOTAL_INFLATED_BYTES) break;
        entries.set(name, inflated.toString('utf8'));
      }
    } catch (err) {
      logServerEvent('warn', 'ads.xlsx_parser', 'Skipped malformed local ZIP entry', {
        entryName: name,
        ...summarizeError(err),
      });
    }
    offset = dataStart + compSize;
  }
  if (entries.size === 0) {
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        const total = Math.min(MAX_ZIP_ENTRIES, buf.readUInt16LE(i + 10));
        let cdOffset = buf.readUInt32LE(i + 16);
        for (let e = 0; e < total && cdOffset + 46 <= buf.length; e++) {
          if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break;
          const method = buf.readUInt16LE(cdOffset + 10);
          const compSize = buf.readUInt32LE(cdOffset + 20);
          const uncompSize = buf.readUInt32LE(cdOffset + 24);
          const nameLen = buf.readUInt16LE(cdOffset + 28);
          const extraLen = buf.readUInt16LE(cdOffset + 30);
          const commentLen = buf.readUInt16LE(cdOffset + 32);
          const lfhOffset = buf.readUInt32LE(cdOffset + 42);
          const name = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8');
          if (
            uncompSize <= MAX_ZIP_ENTRY_INFLATED_BYTES &&
            lfhOffset + 30 <= buf.length &&
            buf.readUInt32LE(lfhOffset) === 0x04034b50
          ) {
            const lfhNameLen = buf.readUInt16LE(lfhOffset + 26);
            const lfhExtraLen = buf.readUInt16LE(lfhOffset + 28);
            const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
            const compData = buf.subarray(dataStart, dataStart + compSize);
            try {
              if (method === 0) {
                totalInflatedBytes += compData.length;
                if (totalInflatedBytes > MAX_ZIP_TOTAL_INFLATED_BYTES) break;
                entries.set(name, compData.toString('utf8'));
              } else if (method === 8) {
                const inflated = zlib.inflateRawSync(compData, { maxOutputLength: MAX_ZIP_ENTRY_INFLATED_BYTES });
                totalInflatedBytes += inflated.length;
                if (totalInflatedBytes > MAX_ZIP_TOTAL_INFLATED_BYTES) break;
                entries.set(name, inflated.toString('utf8'));
              }
            } catch (err) {
              logServerEvent('warn', 'ads.xlsx_parser', 'Skipped malformed central-dir ZIP entry', {
                entryName: name,
                ...summarizeError(err),
              });
            }
          }
          cdOffset += 46 + nameLen + extraLen + commentLen;
        }
        break;
      }
    }
  }
  return entries;
}

export function parseXlsxSheetsToGrids(buf: Buffer): string[][][] {
  const entries = extractZipEntries(buf);
  const sharedStrings: string[] = [];
  const sstXml = entries.get('xl/sharedStrings.xml');
  if (sstXml) {
    for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const tMatches = Array.from(m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g));
      sharedStrings.push(tMatches.map((tm) => decodeXmlEntities(tm[1])).join(''));
    }
  }

  const sheetEntries = Array.from(entries.entries())
    .filter(([k]) => k.startsWith('xl/worksheets/sheet') && k.endsWith('.xml'))
    .sort(([a], [b]) => a.localeCompare(b));

  return sheetEntries.map(([, sheetXml]) => {
    const rows: string[][] = [];
    for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowCells: string[] = [];
      let nextCol = 0;
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1] || '';
        const content = cm[2] || '';
        const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
        const colIdx = refMatch ? letterToColIndex(refMatch[1]) : nextCol;
        nextCol = colIdx + 1;
        const typeMatch = attrs.match(/\bt="([^"]+)"/);
        const cellType = typeMatch ? typeMatch[1] : '';
        let val = '';
        if (cellType === 'inlineStr') {
          val = Array.from(content.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
            .map((tm) => decodeXmlEntities(tm[1]))
            .join('');
        } else if (cellType === 's') {
          const vMatch = content.match(/<v>(\d+)<\/v>/);
          if (vMatch) val = sharedStrings[Number(vMatch[1])] ?? '';
        } else {
          const vMatch = content.match(/<v>([\s\S]*?)<\/v>/);
          val = vMatch ? decodeXmlEntities(vMatch[1]) : '';
        }
        while (rowCells.length <= colIdx) rowCells.push('');
        rowCells[colIdx] = val.trim();
      }
      if (rowCells.some((c) => c !== '')) rows.push(rowCells);
    }
    return rows;
  });
}

export function parseCsvBufferToGrid(buf: Buffer): string[][] {
  let text = '';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.subarray(2).toString('utf16le');
  } else {
    text = buf.toString('utf8').replace(/^\uFEFF/, '');
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const sampleLine =
    lines.find((l) => l.includes('\t') || (l.match(/,/g) || []).length >= 3) || lines[0];
  const delimiter = sampleLine.includes('\t')
    ? '\t'
    : (sampleLine.match(/;/g) || []).length > (sampleLine.match(/,/g) || []).length
      ? ';'
      : ',';

  return lines.map((line) => {
    if (delimiter === '\t') {
      return line.split('\t').map((c) => c.trim().replace(/^"|"$/g, ''));
    }
    const cols: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  });
}

export function parseNumericCell(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/[^\d.,-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

export function slugifyCode(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}
