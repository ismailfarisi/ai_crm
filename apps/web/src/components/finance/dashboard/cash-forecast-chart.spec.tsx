import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CashForecastChart } from './cash-forecast-chart';

const forecast = {
  baseCurrency: 'AED',
  months: [
    { month: '2026-11', opening: 1000, inflows: 500, billsOut: 200, recurringOut: 100, payrollOut: 3000, closing: 1200 },
    { month: '2026-12', opening: 1200, inflows: 0, billsOut: 0, recurringOut: 5000, payrollOut: 0, closing: -3800 },
  ],
};

describe('CashForecastChart', () => {
  it('exposes an accessible title and summary', () => {
    render(<CashForecastChart forecast={forecast} />);
    expect(screen.getByRole('img', { name: /^Next 6 months/ })).toBeTruthy();
    expect(document.getElementById('cash-forecast-desc')?.textContent).toContain('Dec: in');
  });

  it('mentions payroll in the summary and legend', () => {
    render(<CashForecastChart forecast={forecast} />);
    expect(document.getElementById('cash-forecast-desc')?.textContent).toMatch(/payroll/i);
    expect(screen.getByText('Payroll')).toBeTruthy();
  });

  it('shows an empty state with no movements', () => {
    render(<CashForecastChart forecast={{ baseCurrency: 'AED', months: [] }} />);
    expect(screen.getByTestId('cash-forecast-empty')).toBeTruthy();
  });
});
