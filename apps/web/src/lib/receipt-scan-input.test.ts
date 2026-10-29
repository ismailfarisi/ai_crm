import { describe, expect, it } from 'vitest';
import { receiptScanInput, svgText } from './receipt-scan-input';

describe('receiptScanInput', () => {
  it('sends a picked file as the file, PDF or photo alike', () => {
    const pdf = new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' });
    expect(receiptScanInput('data:application/pdf;base64,JVBERg==', pdf)).toEqual({ file: pdf });
  });

  it('sends a saved receipt as its link', () => {
    expect(receiptScanInput('https://files.example/r.png', null)).toEqual({ imageUrl: 'https://files.example/r.png' });
  });

  it('unpacks a base64 data URL with its real type', () => {
    expect(receiptScanInput('data:application/pdf;base64,JVBERg==', null)).toEqual({
      base64: 'JVBERg==',
      mimeType: 'application/pdf',
    });
  });

  it('sends a text SVG as the words on it', () => {
    const svg =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent('<svg><text x="1">ACME CLOUD CORP</text><rect/><text>TOTAL &amp; TAX $285.00</text></svg>');
    expect(receiptScanInput(svg, null)).toEqual({ rawText: 'ACME CLOUD CORP\nTOTAL & TAX $285.00' });
  });
});

describe('svgText', () => {
  it('falls back to the text between tags when there are no text elements', () => {
    expect(svgText('<svg><g>Hello</g> <g>world</g></svg>')).toBe('Hello world');
  });
});
