import { auditSubjectFor, subjectForSegment } from './audit-subjects';

describe('auditSubjectFor', () => {
  it('prefers a two-segment key under /finance', () => {
    const s = auditSubjectFor(['finance', 'subscriptions', 'abc', 'pause']);
    expect(s.key).toBe('finance/subscriptions');
    expect(s.mapped?.subject).toBe('RECURRING_EXPENSE');
    expect(s.idSegment).toBe('abc');
  });

  it('keeps one-segment keys working', () => {
    const s = auditSubjectFor(['bills', 'xyz', 'approve']);
    expect(s.key).toBe('bills');
    expect(s.idSegment).toBe('xyz');
  });

  it('maps finance expenses and accounts', () => {
    expect(auditSubjectFor(['finance', 'expenses', 'e1']).mapped?.subject).toBe(
      'EXPENSE_CLAIM',
    );
    expect(auditSubjectFor(['finance', 'accounts', 'a1']).mapped?.subject).toBe(
      'FINANCE_ACCOUNT',
    );
    expect(
      auditSubjectFor(['finance', 'prepaid-schedules', 'p1', 'end-early'])
        .mapped?.subject,
    ).toBe('PREPAID_SCHEDULE');
  });

  it('names an unmapped two-segment key by its last segment', () => {
    expect(subjectForSegment('finance/budgets')).toBe('BUDGET');
  });

  it('gives a non-id segment such as accounts/transfer no mapped id to snapshot', () => {
    const s = auditSubjectFor(['finance', 'accounts', 'transfer']);
    expect(s.mapped?.subject).toBe('FINANCE_ACCOUNT');
    expect(s.idSegment).toBe('transfer');
  });
});

describe('payroll subjects', () => {
  it('maps employees, payroll runs and opening gratuity', () => {
    expect(auditSubjectFor(['employees', 'e1']).mapped?.subject).toBe('EMPLOYEE');
    expect(auditSubjectFor(['payroll-runs', 'r1', 'approve']).mapped?.subject).toBe('PAYROLL_RUN');
    const s = auditSubjectFor(['payroll', 'opening-gratuity']);
    expect(s.key).toBe('payroll/opening-gratuity');
    expect(s.mapped?.subject).toBe('PAYROLL');
  });
});
