import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { WorkOrderLabourDto } from '@saas/shared';
import { WorkOrderLabourPanel } from './work-order-labour-panel';

const full: WorkOrderLabourDto = {
  actual: 300, provisional: 120, unlinked: 40, total: 460, unlinkedHours: 2, status: 'PROVISIONAL',
  byEmployee: [
    { employeeId: 'e1', employeeName: 'Amina Khan', hours: 6, rate: 50, amount: 300, status: 'ACTUAL' },
    { employeeId: 'e1', employeeName: 'Amina Khan', hours: 3, rate: 40, amount: 120, status: 'PROVISIONAL' },
  ],
};

describe('WorkOrderLabourPanel', () => {
  it('renders nothing when labour is null', () => {
    const { container } = render(<WorkOrderLabourPanel labour={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an employee with both actual and provisional rows, the status chip, unlinked footer and totals', () => {
    render(<WorkOrderLabourPanel labour={full} />);
    const rows = screen.getAllByTestId('labour-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Actual')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Provisional')).toBeInTheDocument();
    expect(within(rows[0]).getByText('300.00')).toBeInTheDocument();
    expect(screen.getByTestId('labour-status')).toHaveTextContent('Provisional — waiting on payroll');
    const unlinked = screen.getByTestId('labour-unlinked');
    expect(unlinked).toHaveTextContent(/Clock time from users not linked to an employee/);
    expect(unlinked).toHaveTextContent('40.00');
    expect(screen.getByTestId('labour-totals')).toHaveTextContent('460.00');
  });

  it('masks rate and amount with a dash and a reason, never 0, and hides totals without cost access', () => {
    render(
      <WorkOrderLabourPanel
        labour={{
          actual: null, provisional: null, unlinked: null, total: null, unlinkedHours: 0, status: 'ACTUAL',
          byEmployee: [{ employeeId: 'e1', employeeName: 'Amina Khan', hours: 6, rate: null, amount: null, status: 'ACTUAL' }],
        }}
      />,
    );
    const masked = screen.getAllByTestId('masked');
    expect(masked).toHaveLength(2);
    for (const m of masked) {
      expect(m).toHaveTextContent('—');
      expect(m).toHaveAttribute('title', 'Needs cost and payroll access');
    }
    expect(screen.getByText('Actual', { selector: 'span[data-testid="labour-status"]' })).toBeInTheDocument();
    expect(screen.queryByTestId('labour-totals')).not.toBeInTheDocument();
    expect(screen.queryByTestId('labour-unlinked')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it.each([
    ['MIXED', 'Actual + standard'],
    ['STANDARD', 'Standard rates'],
  ] as const)('labels %s status', (status, text) => {
    render(<WorkOrderLabourPanel labour={{ ...full, status }} />);
    expect(screen.getByTestId('labour-status')).toHaveTextContent(text);
  });
});
