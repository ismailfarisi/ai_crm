import { getMetadataArgsStorage } from 'typeorm';
import { Quote } from './quote.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

describe('Quote Entity', () => {
  it('has numericTransformer applied to all monetary amount columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (col) => col.target === Quote,
    );

    const monetaryFields = [
      'subtotalAmount',
      'discountAmount',
      'taxAmount',
      'totalAmount',
    ];

    for (const field of monetaryFields) {
      const col = columns.find((c) => c.propertyName === field);
      expect(col).toBeDefined();
      expect(col?.options.transformer).toBe(numericTransformer);
    }
  });

  it('correctly parses postgres numeric strings into numbers', () => {
    expect(numericTransformer.from('9.50')).toBe(9.5);
    expect(numericTransformer.from('6250.00')).toBe(6250);
    expect(numericTransformer.from('0.00')).toBe(0);
    expect(numericTransformer.from(null)).toBe(0);
    expect(numericTransformer.from(undefined)).toBe(0);
    expect(numericTransformer.from(123.45)).toBe(123.45);
  });
});
