export class SignalExecutionDto {
  action: 'APPROVE' | 'REJECT';
  nodeId: string;
  reason?: string;
  comment?: string;
}
