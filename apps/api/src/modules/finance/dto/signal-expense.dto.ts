export class SignalExpenseDto {
  action: 'APPROVE' | 'REJECT' | 'REIMBURSE';
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  accountId?: string;
  reimbursedBy?: string;
  notes?: string;
}
