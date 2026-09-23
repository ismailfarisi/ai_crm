import { describe, it, expect } from 'vitest';
import { CHANNEL_SKILLS, type ChannelResultType } from './skills';

describe('CHANNEL_SKILLS', () => {
  it('defines delivery.dispatch and sales_order.from_document', () => {
    expect(CHANNEL_SKILLS.DELIVERY_DISPATCH).toBe('delivery.dispatch');
    expect(CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT).toBe('sales_order.from_document');
  });

  it('supports DELIVERY_NOTE and SALES_ORDER result types', () => {
    const dnType: ChannelResultType = 'DELIVERY_NOTE';
    const soType: ChannelResultType = 'SALES_ORDER';
    expect(dnType).toBe('DELIVERY_NOTE');
    expect(soType).toBe('SALES_ORDER');
  });
});
