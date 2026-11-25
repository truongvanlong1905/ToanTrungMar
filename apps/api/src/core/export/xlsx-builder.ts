/**
 * Standardized Executive OpenXML (.xlsx) Workbook Generator
 * Pure Node.js implementation using built-in zlib (zero external dependencies).
 * Generates genuine binary PKZip .xlsx files compliant with Microsoft Excel, LibreOffice & Google Sheets.
 *
 * Executive Design System Features:
 * - Full-width Midnight Navy brand banner (#0B1D48) with merged cells & sky-blue accent divider
 * - Structured metadata strip + executive KPI summary cards
 * - Crisp Navy Blue table headers (#1E3A8A), bold white text, frozen header panes & AutoFilter
 * - Native Excel live formulas (<f>...</f>) for both data rows & summary rows (SUM / AVERAGE / IFERROR)
 * - Semantic status cell styling (Success emerald, Warning amber, Danger rose)
 * - Alternating zebra striping, VND currency formatting (#,##0" ₫"), percent (0.00%) & integer (#,##0)
 * - Landscape print page setup (fit-to-1-page-wide) for clean PDF/print output
 * - Safe string escaping (preventing spreadsheet formula injection on user text)
 * - Explicit string type for phone numbers & codes (preserves leading zeros like 0903123456)
 */

import zlib from 'node:zlib';

export interface XlsxFormulaCell {
  formula: string;
  value?: number | string | null;
}

export interface XlsxFormulaContext {
  rowNum: number;
  colLetters: Record<string, string>;
}

export interface XlsxSummaryFormulaContext {
  firstDataRow: number;
  lastDataRow: number;
  summaryRowNum: number;
  colLetters: Record<string, string>;
}

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  type?: 'string' | 'number' | 'currency' | 'percent' | 'date';
  /** Optional native Excel formula generator for each data row (e.g. CTR, CPC, CPL) */
  rowFormula?: (ctx: XlsxFormulaContext) => string | null;
  /** Optional native Excel aggregation for the summaryRow: 'sum', 'avg', 'none', or custom formula builder */
  summaryAgg?: 'sum' | 'avg' | 'none' | ((ctx: XlsxSummaryFormulaContext) => string | null);
}

export interface XlsxSheet {
  name: string;
  title?: string;
  subtitle?: string;
  metadata?: Array<{ label: string; value: string }>;
  kpiSummary?: Array<{ label: string; value: string | number }>;
  columns: XlsxColumn[];
  rows: Array<Record<string, unknown>>;
  summaryRow?: Record<string, unknown>;
  footerNotes?: string[];
}

function isFormulaCell(val: unknown): val is XlsxFormulaCell {
  return (
    typeof val === 'object' &&
    val !== null &&
    'formula' in val &&
    typeof (val as { formula?: unknown }).formula === 'string'
  );
}

function escapeXml(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sanitizeForFormulaInjection(val: string): string {
  if (!val) return '';
  // Prepend single quote if string begins with formula trigger chars (=, +, -, @, or leading tab/CR/LF before formula)
  if (/^[=+\-@\t\r\n]/.test(val) || /^[\s]*[=+\-@]/.test(val)) {
    return `'${val}`;
  }
  return val;
}

export function sanitizeXlsxSheetName(rawName: string, usedNames: Set<string>): string {
  const cleaned =
    (rawName || 'Sheet')
      .replace(/[:\\/?*\[\]\0]/g, '_')
      .replace(/^'+|'+$/g, '')
      .trim() || 'Sheet';
  let candidate = cleaned.slice(0, 31);
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const tag = `_${suffix}`;
    candidate = `${cleaned.slice(0, Math.max(1, 31 - tag.length))}${tag}`;
    suffix++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

// Convert 0-indexed column number to Excel column letters (0 -> A, 27 -> AB)
function colToLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function detectSemanticStatusStyle(colKey: string, rawText: string): number | null {
  const keyLower = colKey.toLowerCase();
  if (
    !keyLower.includes('status') &&
    !keyLower.includes('badge') &&
    !keyLower.includes('trend') &&
    !keyLower.includes('optimization')
  ) {
    return null;
  }
  const lower = rawText.toLowerCase();
  if (
    lower.includes('thành công') ||
    lower.includes('won') ||
    lower.includes('đang chạy') ||
    lower.includes('khớp 100%') ||
    lower.includes('đã chốt') ||
    lower.includes('hợp lệ (mới)') ||
    lower.includes('tăng trưởng') ||
    lower.includes('đạt kiểm tra') ||
    lower.includes('đã đăng')
  ) {
    return 16; // Emerald success badge
  }
  if (
    lower.includes('thất bại') ||
    lower.includes('lost') ||
    lower.includes('spam') ||
    lower.includes('lỗi') ||
    lower.includes('cảnh báo') ||
    lower.includes('trùng lead') ||
    lower.includes('quá hạn')
  ) {
    return 18; // Rose danger badge
  }
  if (
    lower.includes('tạm dừng') ||
    lower.includes('chờ') ||
    lower.includes('quay lại') ||
    lower.includes('nháp') ||
    lower.includes('cần tối ưu') ||
    lower.includes('đang soạn') ||
    lower.includes('báo giá')
  ) {
    return 17; // Amber warning badge
  }
  return null;
}

/**
 * Lightweight ZIP (PKZip) packager using standard Node.js zlib
 */
export class ZipArchive {
  private files: Array<{
    name: string;
    data: Buffer;
    crc32: number;
    compressed: Buffer;
  }> = [];

  addFile(name: string, content: string | Buffer): void {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const crc = this.computeCrc32(data);
    const compressed = zlib.deflateRawSync(data);
    this.files.push({ name, data, crc32: crc, compressed });
  }

  toBuffer(): Buffer {
    const localHeaders: Buffer[] = [];
    const centralDirs: Buffer[] = [];
    let offset = 0;

    for (const file of this.files) {
      const nameBuf = Buffer.from(file.name, 'utf8');

      const lfh = Buffer.alloc(30 + nameBuf.length);
      lfh.writeUInt32LE(0x04034b50, 0);
      lfh.writeUInt16LE(20, 4);
      lfh.writeUInt16LE(0, 6);
      lfh.writeUInt16LE(8, 8);
      lfh.writeUInt16LE(0, 10);
      lfh.writeUInt16LE(0, 12);
      lfh.writeUInt32LE(file.crc32, 14);
      lfh.writeUInt32LE(file.compressed.length, 18);
      lfh.writeUInt32LE(file.data.length, 22);
      lfh.writeUInt16LE(nameBuf.length, 26);
      lfh.writeUInt16LE(0, 28);
      nameBuf.copy(lfh, 30);

      localHeaders.push(lfh, file.compressed);

      const cdh = Buffer.alloc(46 + nameBuf.length);
      cdh.writeUInt32LE(0x02014b50, 0);
      cdh.writeUInt16LE(20, 4);
      cdh.writeUInt16LE(20, 6);
      cdh.writeUInt16LE(0, 8);
      cdh.writeUInt16LE(8, 10);
      cdh.writeUInt16LE(0, 12);
      cdh.writeUInt16LE(0, 14);
      cdh.writeUInt32LE(file.crc32, 16);
      cdh.writeUInt32LE(file.compressed.length, 20);
      cdh.writeUInt32LE(file.data.length, 24);
      cdh.writeUInt16LE(nameBuf.length, 28);
      cdh.writeUInt16LE(0, 30);
      cdh.writeUInt16LE(0, 32);
      cdh.writeUInt16LE(0, 34);
      cdh.writeUInt16LE(0, 36);
      cdh.writeUInt32LE(0, 38);
      cdh.writeUInt32LE(offset, 42);
      nameBuf.copy(cdh, 46);

      centralDirs.push(cdh);
      offset += lfh.length + file.compressed.length;
    }

    const centralDirBuffer = Buffer.concat(centralDirs);
    const centralDirSize = centralDirBuffer.length;
    const centralDirOffset = offset;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.files.length, 8);
    eocd.writeUInt16LE(this.files.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
  }

  private computeCrc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i];
      crc ^= byte;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}

/**
 * Executive Corporate Stylesheet (xl/styles.xml)
 * Style IDs:
 *  0: Normal
 *  1: Executive Title Banner (Bold 14pt White on Midnight Navy #0B1D48, Accent Blue Bottom Border)
 *  2: Table Header (Bold 11pt White on Corporate Navy #1E3A8A, Center/Wrap)
 *  3: Zebra Text Cell (#F8FAFC fill, thin slate border)
 *  4: Plain Text Cell (White fill, thin slate border)
 *  5: Plain Number (#,##0, Right align)
 *  6: Plain Percent (0.00%, Right align)
 *  7: KPI Card / Summary Text (Bold 10.5pt Navy #0B1D48 on Ice Blue #DBEAFE, Strong Navy Borders)
 *  8: Plain Currency (#,##0" ₫", Right align)
 *  9: Zebra Number (#,##0, #F8FAFC fill, Right align)
 * 10: Zebra Currency (#,##0" ₫", #F8FAFC fill, Right align)
 * 11: Zebra Percent (0.00%, #F8FAFC fill, Right align)
 * 12: Summary Number (Bold #,##0, #DBEAFE fill, Top/Bottom Navy Border)
 * 13: Summary Currency (Bold #,##0" ₫", #DBEAFE fill, Top/Bottom Navy Border)
 * 14: Summary Percent (Bold 0.00%, #DBEAFE fill, Top/Bottom Navy Border)
 * 15: Metadata Strip (10pt Slate #334155, Soft Gray #F1F5F9 fill)
 * 16: Status Success Badge (Bold Emerald #065F46 on #ECFDF5)
 * 17: Status Warning Badge (Bold Amber #92400E on #FFFBEB)
 * 18: Status Danger Badge (Bold Rose #991B1B on #FEF2F2)
 * 19: Footer Note (Italic 9.5pt #475569 on #F8FAFC)
 */
function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="0.00%"/>
    <numFmt numFmtId="166" formatCode="#,##0&quot; ₫&quot;"/>
  </numFmts>
  <fonts count="10">
    <font><sz val="10.5"/><name val="Segoe UI"/><color rgb="FF1E293B"/></font>
    <font><b/><sz val="14"/><name val="Segoe UI"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="10.5"/><name val="Segoe UI"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="10.5"/><name val="Segoe UI"/><color rgb="FF0B1D48"/></font>
    <font><sz val="10"/><name val="Segoe UI"/><color rgb="FF334155"/></font>
    <font><b/><sz val="10"/><name val="Segoe UI"/><color rgb="FF065F46"/></font>
    <font><b/><sz val="10"/><name val="Segoe UI"/><color rgb="FF92400E"/></font>
    <font><b/><sz val="10"/><name val="Segoe UI"/><color rgb="FF991B1B"/></font>
    <font><i/><sz val="9.5"/><name val="Segoe UI"/><color rgb="FF475569"/></font>
    <font><b/><sz val="10.5"/><name val="Segoe UI"/><color rgb="FF0F172A"/></font>
  </fonts>
  <fills count="11">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B1D48"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFBEB"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF2F2"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
  </fills>
  <borders count="6">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FF1E3A8A"/></left>
      <right style="thin"><color rgb="FF1E3A8A"/></right>
      <top style="medium"><color rgb="FF1E3A8A"/></top>
      <bottom style="medium"><color rgb="FF1E3A8A"/></bottom>
    </border>
    <border>
      <bottom style="thick"><color rgb="FF2563EB"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FF3B82F6"/></left>
      <right style="thin"><color rgb="FF3B82F6"/></right>
      <top style="thin"><color rgb="FF1E3A8A"/></top>
      <bottom style="medium"><color rgb="FF0B1D48"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="20">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center" indent="1"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="166" fontId="9" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="166" fontId="9" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="164" fontId="3" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="166" fontId="3" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="165" fontId="3" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center" indent="1"/>
    </xf>
    <xf numFmtId="0" fontId="5" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="6" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="7" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="8" fillId="3" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center" wrapText="1"/>
    </xf>
  </cellXfs>
</styleSheet>`;
}

function resolveDataCellStyle(col: XlsxColumn, isZebra: boolean): number {
  if (col.type === 'currency') return isZebra ? 10 : 8;
  if (col.type === 'percent') return isZebra ? 11 : 6;
  if (col.type === 'number') return isZebra ? 9 : 5;
  return isZebra ? 3 : 4;
}

function resolveSummaryCellStyle(col: XlsxColumn): number {
  if (col.type === 'currency') return 13;
  if (col.type === 'percent') return 14;
  if (col.type === 'number') return 12;
  return 7;
}

function renderFormulaCellXml(
  cellRef: string,
  styleId: number,
  formula: string,
  cachedValue?: number | string | null,
): string {
  const cleanFormula = formula.replace(/^=/, '');
  if (typeof cachedValue === 'number' && Number.isFinite(cachedValue)) {
    return `<c r="${cellRef}" s="${styleId}"><f>${escapeXml(cleanFormula)}</f><v>${cachedValue}</v></c>`;
  }
  return `<c r="${cellRef}" s="${styleId}"><f>${escapeXml(cleanFormula)}</f></c>`;
}

function buildSheetXml(sheet: XlsxSheet): string {
  let currentRow = 1;
  const rowsXml: string[] = [];
  const mergeRefs: string[] = [];

  const colCount = Math.max(1, sheet.columns.length);
  const lastColLetter = colToLetter(colCount - 1);
  const colLetters: Record<string, string> = {};
  sheet.columns.forEach((col, idx) => {
    colLetters[col.key] = colToLetter(idx);
  });

  // 1. Executive Midnight-Navy Title Banner (merged full table width)
  if (sheet.title) {
    const bannerCells = sheet.columns
      .map((_, idx) => {
        const ref = `${colToLetter(idx)}${currentRow}`;
        if (idx === 0) {
          return `<c r="${ref}" s="1" t="inlineStr"><is><t>${escapeXml(sheet.title)}</t></is></c>`;
        }
        return `<c r="${ref}" s="1"/>`;
      })
      .join('');
    rowsXml.push(`<row r="${currentRow}" ht="36" customHeight="1">${bannerCells}</row>`);
    if (colCount > 1) {
      mergeRefs.push(`A${currentRow}:${lastColLetter}${currentRow}`);
    }
    currentRow++;
  }

  // 2. Metadata Strip (merged cleanly across width)
  if (sheet.metadata && sheet.metadata.length > 0) {
    for (const meta of sheet.metadata) {
      const metaText = `${meta.label}: ${meta.value}`;
      const metaCells = sheet.columns
        .map((_, idx) => {
          const ref = `${colToLetter(idx)}${currentRow}`;
          if (idx === 0) {
            return `<c r="${ref}" s="15" t="inlineStr"><is><t>${escapeXml(metaText)}</t></is></c>`;
          }
          return `<c r="${ref}" s="15"/>`;
        })
        .join('');
      rowsXml.push(`<row r="${currentRow}" ht="20" customHeight="1">${metaCells}</row>`);
      if (colCount > 1) {
        mergeRefs.push(`A${currentRow}:${lastColLetter}${currentRow}`);
      }
      currentRow++;
    }
  }

  // 3. Executive KPI Summary Strip
  if (sheet.kpiSummary && sheet.kpiSummary.length > 0) {
    const kpiCount = sheet.kpiSummary.length;
    const spanPerKpi = Math.max(1, Math.floor(colCount / kpiCount));
    const kpiRowCells: string[] = [];
    for (let k = 0; k < kpiCount; k++) {
      const startCol = k * spanPerKpi;
      if (startCol >= colCount) break;
      const endCol = k === kpiCount - 1 ? colCount - 1 : Math.min(colCount - 1, startCol + spanPerKpi - 1);
      const kpi = sheet.kpiSummary[k];
      const labelVal = `${kpi.label}: ${kpi.value}`;
      for (let c = startCol; c <= endCol; c++) {
        const ref = `${colToLetter(c)}${currentRow}`;
        if (c === startCol) {
          kpiRowCells.push(`<c r="${ref}" s="7" t="inlineStr"><is><t>${escapeXml(labelVal)}</t></is></c>`);
        } else {
          kpiRowCells.push(`<c r="${ref}" s="7"/>`);
        }
      }
      if (endCol > startCol) {
        mergeRefs.push(`${colToLetter(startCol)}${currentRow}:${colToLetter(endCol)}${currentRow}`);
      }
    }
    rowsXml.push(`<row r="${currentRow}" ht="30" customHeight="1">${kpiRowCells.join('')}</row>`);
    currentRow++;
  }

  // Compact breathing row before main table
  rowsXml.push(`<row r="${currentRow}" ht="10" customHeight="1"/>`);
  currentRow++;

  const headerRowIndex = currentRow;

  // Auto-calculated column widths with generous padding so numbers/VND never display ###
  const colsXml: string[] = ['<cols>'];
  sheet.columns.forEach((col, idx) => {
    let maxLen = col.header.length;
    for (let r = 0; r < Math.min(sheet.rows.length, 250); r++) {
      const rawVal = sheet.rows[r]?.[col.key];
      const val = isFormulaCell(rawVal) ? rawVal.value : rawVal;
      if (val != null) {
        const strLen =
          col.type === 'currency' && typeof val === 'number'
            ? `${Math.round(val).toLocaleString('en-US')} ₫`.length
            : String(val).length;
        if (strLen > maxLen) maxLen = strLen;
      }
    }
    const minW = col.type === 'currency' ? 18 : col.type === 'percent' ? 13 : 11;
    const autoWidth = Math.min(58, Math.max(col.width || minW, Math.min(maxLen + 5, 48)));
    colsXml.push(`<col min="${idx + 1}" max="${idx + 1}" width="${autoWidth}" customWidth="1"/>`);
  });
  colsXml.push('</cols>');

  // 4. Table Header Row (#1E3A8A, Bold White, 34px)
  const headerCells = sheet.columns
    .map((col, idx) => {
      const colLetter = colToLetter(idx);
      return `<c r="${colLetter}${headerRowIndex}" s="2" t="inlineStr"><is><t>${escapeXml(col.header)}</t></is></c>`;
    })
    .join('');

  rowsXml.push(`<row r="${headerRowIndex}" ht="34" customHeight="1">${headerCells}</row>`);
  currentRow++;

  const firstDataRow = currentRow;

  // 5. Data Rows (with zebra striping, currency/percent formatting, semantic status colors & live formulas)
  sheet.rows.forEach((row, rowIdx) => {
    const isZebra = rowIdx % 2 === 1;
    const rowNum = currentRow;

    const cells = sheet.columns
      .map((col, colIdx) => {
        const colLetter = colToLetter(colIdx);
        const cellRef = `${colLetter}${rowNum}`;
        const rawVal = row[col.key];
        const baseStyle = resolveDataCellStyle(col, isZebra);

        // Explicit formula object in cell data
        if (isFormulaCell(rawVal)) {
          return renderFormulaCellXml(cellRef, baseStyle, rawVal.formula, rawVal.value);
        }

        // Column-level formula generator (e.g. CTR, CPC, CPL, Win Rate)
        if (col.rowFormula) {
          const generatedFormula = col.rowFormula({ rowNum, colLetters });
          if (generatedFormula) {
            const cachedNum =
              typeof rawVal === 'number' && Number.isFinite(rawVal)
                ? rawVal
                : rawVal != null && rawVal !== '' && !Number.isNaN(Number(rawVal))
                  ? Number(rawVal)
                  : undefined;
            return renderFormulaCellXml(cellRef, baseStyle, generatedFormula, cachedNum);
          }
        }

        if (rawVal == null || rawVal === '') {
          return `<c r="${cellRef}" s="${isZebra ? 3 : 4}"/>`;
        }

        if (col.type === 'number' || col.type === 'currency' || col.type === 'percent') {
          const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
          if (!Number.isNaN(num) && Number.isFinite(num)) {
            return `<c r="${cellRef}" s="${baseStyle}"><v>${num}</v></c>`;
          }
        }

        const strVal = String(rawVal);
        const semanticStyle = detectSemanticStatusStyle(col.key, strVal);
        const sanitized = sanitizeForFormulaInjection(strVal);
        return `<c r="${cellRef}" s="${semanticStyle ?? (isZebra ? 3 : 4)}" t="inlineStr"><is><t>${escapeXml(sanitized)}</t></is></c>`;
      })
      .join('');

    rowsXml.push(`<row r="${rowNum}" ht="23" customHeight="1">${cells}</row>`);
    currentRow++;
  });

  const lastDataRow = Math.max(firstDataRow, currentRow - 1);
  const hasDataRows = sheet.rows.length > 0;

  // 6. Executive Summary / Totals Footer Row (with live native Excel SUM / AVG / IFERROR formulas!)
  if (sheet.summaryRow) {
    const summaryRowNum = currentRow;
    const summaryCells = sheet.columns
      .map((col, colIdx) => {
        const colLetter = colToLetter(colIdx);
        const cellRef = `${colLetter}${summaryRowNum}`;
        const rawVal = sheet.summaryRow?.[col.key];
        const sumStyle = resolveSummaryCellStyle(col);

        if (isFormulaCell(rawVal)) {
          return renderFormulaCellXml(cellRef, sumStyle, rawVal.formula, rawVal.value);
        }

        // Column-configured summary aggregation formula
        if (hasDataRows && col.summaryAgg && col.summaryAgg !== 'none') {
          let sumFormula: string | null = null;
          if (typeof col.summaryAgg === 'function') {
            sumFormula = col.summaryAgg({
              firstDataRow,
              lastDataRow,
              summaryRowNum,
              colLetters,
            });
          } else if (col.summaryAgg === 'sum') {
            sumFormula = `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})`;
          } else if (col.summaryAgg === 'avg') {
            sumFormula = `IFERROR(AVERAGE(${colLetter}${firstDataRow}:${colLetter}${lastDataRow}),0)`;
          }
          if (sumFormula) {
            const cachedNum =
              typeof rawVal === 'number' && Number.isFinite(rawVal)
                ? rawVal
                : rawVal != null && rawVal !== '' && !Number.isNaN(Number(rawVal))
                  ? Number(rawVal)
                  : undefined;
            return renderFormulaCellXml(cellRef, sumStyle, sumFormula, cachedNum);
          }
        }

        if (rawVal == null || rawVal === '') {
          return `<c r="${cellRef}" s="7"/>`;
        }

        if (col.type === 'number' || col.type === 'currency' || col.type === 'percent') {
          const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
          if (!Number.isNaN(num) && Number.isFinite(num)) {
            return `<c r="${cellRef}" s="${sumStyle}"><v>${num}</v></c>`;
          }
        }

        const sanitized = sanitizeForFormulaInjection(String(rawVal));
        return `<c r="${cellRef}" s="7" t="inlineStr"><is><t>${escapeXml(sanitized)}</t></is></c>`;
      })
      .join('');

    rowsXml.push(`<row r="${summaryRowNum}" ht="28" customHeight="1">${summaryCells}</row>`);
    currentRow++;
  }

  // 7. Executive Footer Notes (merged cleanly)
  if (sheet.footerNotes && sheet.footerNotes.length > 0) {
    currentRow++;
    for (const note of sheet.footerNotes) {
      const noteText = sanitizeForFormulaInjection(note);
      const noteCells = sheet.columns
        .map((_, idx) => {
          const ref = `${colToLetter(idx)}${currentRow}`;
          if (idx === 0) {
            return `<c r="${ref}" s="19" t="inlineStr"><is><t>${escapeXml(noteText)}</t></is></c>`;
          }
          return `<c r="${ref}" s="19"/>`;
        })
        .join('');
      rowsXml.push(`<row r="${currentRow}" ht="22" customHeight="1">${noteCells}</row>`);
      if (colCount > 1) {
        mergeRefs.push(`A${currentRow}:${lastColLetter}${currentRow}`);
      }
      currentRow++;
    }
  }

  const autoFilterXml = `<autoFilter ref="A${headerRowIndex}:${lastColLetter}${lastDataRow}"/>`;
  const mergeCellsXml =
    mergeRefs.length > 0
      ? `<mergeCells count="${mergeRefs.length}">${mergeRefs.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
      : '';

  const viewsXml = `
  <sheetViews>
    <sheetView tabSelected="1" showGridLines="1" workbookViewId="0">
      <pane ySplit="${headerRowIndex}" topLeftCell="A${firstDataRow}" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>`;

  const pageSetupXml = `
  <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.25" footer="0.25"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  ${viewsXml}
  ${colsXml.join('')}
  <sheetData>
    ${rowsXml.join('\n    ')}
  </sheetData>
  ${autoFilterXml}
  ${mergeCellsXml}
  ${pageSetupXml}
</worksheet>`;
}

export function buildStandardXlsxBuffer(sheets: XlsxSheet[]): Buffer {
  const zip = new ZipArchive();

  const sheetTypes = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('');

  zip.addFile(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetTypes}
</Types>`
  );

  zip.addFile(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  );

  const sheetRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('');
  const stylesRelId = `rId${sheets.length + 1}`;

  zip.addFile(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  );

  const usedSheetNames = new Set<string>();
  const sheetsTag = sheets
    .map((s, i) => {
      const safeName = sanitizeXlsxSheetName(s.name, usedSheetNames);
      return `<sheet name="${escapeXml(safeName)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
    })
    .join('');

  zip.addFile(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetsTag}
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`
  );

  zip.addFile('xl/styles.xml', buildStylesXml());

  sheets.forEach((sheet, idx) => {
    zip.addFile(`xl/worksheets/sheet${idx + 1}.xml`, buildSheetXml(sheet));
  });

  return zip.toBuffer();
}
