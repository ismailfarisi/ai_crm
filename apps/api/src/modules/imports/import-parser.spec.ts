import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { IMPORT_LIMITS } from '@saas/shared';
import { parseSpreadsheet, xlsxUncompressedSize } from './import-parser';

const csv = (text: string, name = 'list.csv') => ({
  originalname: name,
  mimetype: 'text/csv',
  size: Buffer.byteLength(text),
  buffer: Buffer.from(text, 'utf8'),
});

async function xlsx(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customers');
  rows.forEach((r) => sheet.addRow(r));
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    originalname: 'list.xlsx',
    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  };
}

describe('parseSpreadsheet', () => {
  it('reads a CSV with a BOM, quotes and short rows', async () => {
    const parsed = await parseSpreadsheet(
      csv('\uFEFFCompany,Email,City\n"Al Noor, LLC",a@x.ae\n\nBeta,,Dubai\n'),
    );
    expect(parsed.headers).toEqual(['Company', 'Email', 'City']);
    expect(parsed.rows).toEqual([
      ['Al Noor, LLC', 'a@x.ae', ''],
      ['Beta', '', 'Dubai'],
    ]);
  });

  it('reads the semicolon CSV that Excel writes in some locales', async () => {
    const parsed = await parseSpreadsheet(csv('Name;Price\nBox;12,5\n'));
    expect(parsed.rows).toEqual([['Box', '12,5']]);
  });

  it('reads the first sheet of an xlsx, including numbers and formulas', async () => {
    const file = await xlsx([
      ['SKU', 'Name', 'List price'],
      ['BOX-1', 'Gift box', 12.5],
      [
        'BOX-2',
        { richText: [{ text: 'Rigid ' }, { text: 'box' }] },
        { formula: '2*3', result: 6 },
      ],
    ]);
    const parsed = await parseSpreadsheet(file);
    expect(parsed.headers).toEqual(['SKU', 'Name', 'List price']);
    expect(parsed.rows).toEqual([
      ['BOX-1', 'Gift box', '12.5'],
      ['BOX-2', 'Rigid box', '6'],
    ]);
  });

  it('refuses other file types, empty files and files over the row limit', async () => {
    await expect(
      parseSpreadsheet({
        ...csv('a'),
        originalname: 'list.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toThrow('Upload a .csv or .xlsx file.');
    await expect(parseSpreadsheet(csv('Name\n'))).rejects.toThrow(
      'This file has a header but no rows.',
    );
    await expect(parseSpreadsheet(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const big = [
      'Name',
      ...Array.from(
        { length: IMPORT_LIMITS.maxRows + 1 },
        (_, i) => `Row ${i}`,
      ),
    ].join('\n');
    await expect(parseSpreadsheet(csv(big))).rejects.toThrow(
      /more than 5,000 rows/,
    );
  });

  it('measures an xlsx before unpacking it', async () => {
    const file = await xlsx([['Name'], ['Box']]);
    expect(xlsxUncompressedSize(file.buffer)).toBeGreaterThan(
      file.buffer.length,
    );
    expect(
      xlsxUncompressedSize(Buffer.from('not a zip at all, just text')),
    ).toBeNull();
  });
});
