import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiveQuoteDemo } from './live-quote-demo';

/**
 * The demo runs the real costing engine, so these assertions double as a check
 * that the engine still works when bundled for the browser — no Node-only API
 * crept into the pure path.
 */
describe('LiveQuoteDemo', () => {
  it('prices the default box and shows a break table', () => {
    render(<LiveQuoteDemo />);

    expect(screen.getByText('Rigid gift box — live cost model')).toBeDefined();
    // The standard ladder, all priced.
    for (const qty of ['100', '250', '500', '1,000', '2,500']) {
      expect(screen.getByText(qty)).toBeDefined();
    }
  });

  it('breaks cost down into material, machine, labour and tooling', () => {
    render(<LiveQuoteDemo />);

    for (const part of ['Material', 'Machine', 'Labour', 'Tooling']) {
      expect(screen.getByText(part)).toBeDefined();
    }
  });

  it('re-prices when a dimension changes', () => {
    const { container } = render(<LiveQuoteDemo />);
    const before = container.textContent;

    const length = container.querySelector('input[type=number]') as HTMLInputElement;
    fireEvent.change(length, { target: { value: '340' } });

    expect(container.textContent).not.toBe(before);
  });

  /**
   * The failure path is the most valuable thing on the panel: it shows the
   * engine refusing an impossible shape with a reason, rather than quoting
   * something that cannot be made.
   */
  it('explains a shape that does not fit any sheet instead of showing a price', () => {
    const { container } = render(<LiveQuoteDemo />);
    const [length, width, height] = Array.from(
      container.querySelectorAll('input[type=number]'),
    ) as HTMLInputElement[];

    fireEvent.change(length, { target: { value: '600' } });
    fireEvent.change(width, { target: { value: '600' } });
    fireEvent.change(height, { target: { value: '400' } });

    expect(screen.getByText(/can.t be made/)).toBeDefined();
    expect(screen.getByText(/does not fit on/)).toBeDefined();
    expect(screen.queryByText('Price breaks')).toBeNull();
  });

  it('recovers once the dimensions are workable again', () => {
    const { container } = render(<LiveQuoteDemo />);
    const [length, width] = Array.from(
      container.querySelectorAll('input[type=number]'),
    ) as HTMLInputElement[];

    fireEvent.change(length, { target: { value: '600' } });
    fireEvent.change(width, { target: { value: '600' } });
    expect(screen.getByText(/can.t be made/)).toBeDefined();

    fireEvent.change(width, { target: { value: '150' } });
    expect(screen.getByText('Price breaks')).toBeDefined();
  });

  it('is honest that the rates are illustrative', () => {
    render(<LiveQuoteDemo />);
    expect(screen.getByText(/illustrative/)).toBeDefined();
  });
});
