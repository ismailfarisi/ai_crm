import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { IMPORT_LIMITS } from '@saas/shared';
import type { UploadedFileLike } from '../storage/storage.types';

export interface ParsedSheet {
  headers: string[];
  /** Data rows, header excluded, each padded to the header's width. */
  rows: string[][];
  /** Each row's number as the spreadsheet shows it (header = 1), blank rows counted. */
  rowNumbers: number[];
}

/** A row of cells and the spreadsheet row it came from. */
interface RawRow {
  number: number;
  cells: string[];
}

/**
 * An .xlsx is a zip, and a small zip can inflate to gigabytes. Its central
 * directory states every entry's uncompressed size, so the total is checked
 * before anything is unpacked.
 */
const MAX_XLSX_UNCOMPRESSED = 100 * 1024 * 1024;

export function xlsxUncompressedSize(buffer: Buffer): number | null {
  // End of central directory: signature 0x06054b50, within the last 64 KB.
  const floor = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) !== 0x06054b50) continue;
    const entries = buffer.readUInt16LE(i + 10);
    let offset = buffer.readUInt32LE(i + 16);
    let total = 0;
    for (let n = 0; n < entries; n++) {
      if (offset + 46 > buffer.length) return null;
      if (buffer.readUInt32LE(offset) !== 0x02014b50) return null;
      total += buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return total;
  }
  return null;
}

const kindOf = (file: UploadedFileLike): 'csv' | 'xlsx' | null => {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) return 'csv';
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (file.mimetype === 'text/csv') return 'csv';
  if (
    file.mimetype ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'xlsx';
  }
  return null;
};

const tooMany = () =>
  new BadRequestException(
    `This file has more than ${IMPORT_LIMITS.maxRows.toLocaleString('en')} rows. Split it into smaller files.`,
  );

/** Excel saves CSV as comma, semicolon or tab separated depending on locale. */
function delimiterOf(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [',', ';', '\t'].map((d) => ({
    d,
    n: firstLine.split(d).length,
  }));
  return counts.sort((a, b) => b.n - a.n)[0].d;
}

function parseCsv(buffer: Buffer): RawRow[] {
  let text: string;
  try {
    // Excel's plain "CSV" is saved in the PC's code page, which would turn
    // Arabic names into question marks without saying so.
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new BadRequestException(
      'This CSV is not saved as UTF-8. In Excel, save it as "CSV UTF-8", or upload the .xlsx.',
    );
  }
  // Blank lines are counted, not kept, so a row's number is its row in
  // Excel. Reading stops at the row limit rather than parsing the rest.
  let seen = 0;
  let kept = 0;
  let over = false;
  const numbers: number[] = [];
  try {
    const records: string[][] = parse(text, {
      bom: true,
      delimiter: delimiterOf(text.replace(/^\uFEFF/, '')),
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      on_record: (cells) => {
        seen++;
        if (!cells.some((c) => (c ?? '').trim() !== '')) return null;
        // Header plus the limit, plus one to tell "exactly at" from "over".
        if (++kept > IMPORT_LIMITS.maxRows + 1) {
          over = true;
          throw tooMany();
        }
        numbers.push(seen);
        return cells;
      },
    });
    return records.map((cells, i) => ({ number: numbers[i], cells }));
  } catch (e) {
    if (over) throw tooMany();
    throw new BadRequestException(
      `This CSV could not be read: ${(e as Error).message}`,
    );
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** What a person sees in the cell, as text. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return String(value.text);
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

async function parseXlsx(buffer: Buffer): Promise<RawRow[]> {
  const size = xlsxUncompressedSize(buffer);
  if (size === null) {
    throw new BadRequestException('This is not a valid .xlsx file.');
  }
  if (size > MAX_XLSX_UNCOMPRESSED) {
    throw new BadRequestException(
      'This workbook is too large to import. Save the sheet as CSV, or split it.',
    );
  }
  // Streamed, and only the first sheet, so memory is bounded by the row
  // limit rather than by the workbook.
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    worksheets: 'emit',
    entries: 'emit',
  });
  const rows: RawRow[] = [];
  try {
    for await (const worksheet of reader) {
      for await (const row of worksheet as AsyncIterable<ExcelJS.Row>) {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        // `values` is sparse where cells are empty.
        const cells = Array.from(values, (v) => cellText(v).trim());
        if (cells.every((c) => c === '')) continue;
        rows.push({ number: row.number, cells });
        if (rows.length > IMPORT_LIMITS.maxRows + 1) break;
      }
      break;
    }
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException('This .xlsx file could not be read.');
  }
  return rows;
}

/** Reads the first sheet of a CSV or .xlsx upload into a header and rows. */
export async function parseSpreadsheet(
  file: UploadedFileLike | undefined,
): Promise<ParsedSheet> {
  if (!file || !file.buffer?.length) {
    throw new BadRequestException('Choose a file to import.');
  }
  if (file.size > IMPORT_LIMITS.maxBytes) {
    throw new BadRequestException('This file is over the 5 MB limit.');
  }
  const kind = kindOf(file);
  if (!kind) {
    throw new BadRequestException('Upload a .csv or .xlsx file.');
  }
  const all =
    kind === 'csv' ? parseCsv(file.buffer) : await parseXlsx(file.buffer);
  // The first row with anything in it is the header.
  const [header, ...rest] = all;
  if (!header) {
    throw new BadRequestException('This file is empty.');
  }
  if (rest.length > IMPORT_LIMITS.maxRows) throw tooMany();
  const headers = Array.from(header.cells, (h) => (h ?? '').trim());
  const width = headers.length;
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  for (const r of rest) {
    const cells = Array.from(r.cells, (c) => (c ?? '').toString().trim());
    while (cells.length < width) cells.push('');
    rows.push(cells);
    rowNumbers.push(r.number);
  }
  if (rows.length === 0) {
    throw new BadRequestException('This file has a header but no rows.');
  }
  return { headers, rows, rowNumbers };
}
