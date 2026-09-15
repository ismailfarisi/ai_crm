import { toCsv } from './reports.service';

describe('toCsv', () => {
  it('quotes only when needed and doubles embedded quotes', () => {
    expect(
      toCsv(
        ['A', 'B'],
        [
          ['plain', 'has, comma'],
          ['say "hi"', 3],
        ],
      ),
    ).toBe('A,B\r\nplain,"has, comma"\r\n"say ""hi""",3\r\n');
  });

  it('neutralises a cell a spreadsheet would run as a formula, but not a negative number', () => {
    expect(toCsv(['Customer', 'Amount'], [['=HYPERLINK("x")', -12.5]])).toBe(
      'Customer,Amount\r\n"\'=HYPERLINK(""x"")",-12.5\r\n',
    );
  });
});
