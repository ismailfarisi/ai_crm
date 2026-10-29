import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AutomationApprovalsController } from './automation-approvals.controller';
import type { AutomationApprovalsService } from './automation-approvals.service';
import { approvalDecisionSchema } from './approval-decision.dto';

describe('AutomationApprovalsController', () => {
  const user = {
    id: 'user-ana',
    organizationId: 'tenant-1',
    permissions: [PERMISSIONS.AUTOMATION_APPROVE],
  } as AuthenticatedUser;

  let service: jest.Mocked<
    Pick<AutomationApprovalsService, 'listPending' | 'countPending' | 'decide'>
  >;
  let controller: AutomationApprovalsController;

  beforeEach(() => {
    service = {
      listPending: jest.fn().mockResolvedValue([]),
      countPending: jest.fn().mockResolvedValue(3),
      decide: jest.fn().mockResolvedValue({ id: 'appr-1' }),
    };
    controller = new AutomationApprovalsController(
      service as unknown as AutomationApprovalsService,
    );
  });

  it('lives at /automation-approvals, apart from /automations/:id', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, AutomationApprovalsController),
    ).toBe('automation-approvals');
  });

  it.each(['list', 'count', 'decide'] as const)(
    '%s requires automation:approve',
    (method) => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          AutomationApprovalsController.prototype[method],
        ),
      ).toEqual([PERMISSIONS.AUTOMATION_APPROVE]);
    },
  );

  it("lists and counts the caller's organisation", async () => {
    await controller.list(user);
    expect(service.listPending).toHaveBeenCalledWith('tenant-1');
    await expect(controller.count(user)).resolves.toEqual({ count: 3 });
    expect(service.countPending).toHaveBeenCalledWith('tenant-1');
  });

  it('decides as the current user', async () => {
    await controller.decide(user, 'appr-1', {
      action: 'APPROVE',
      comment: 'ok',
    });
    expect(service.decide).toHaveBeenCalledWith('tenant-1', 'appr-1', user, {
      action: 'APPROVE',
      comment: 'ok',
    });
  });

  describe('decision body', () => {
    const pipe = zodBody(approvalDecisionSchema);

    it('accepts APPROVE and REJECT with an optional comment', () => {
      expect(pipe.transform({ action: 'APPROVE' })).toEqual({
        action: 'APPROVE',
      });
      expect(
        pipe.transform({ action: 'REJECT', comment: 'x'.repeat(1000) }),
      ).toEqual({ action: 'REJECT', comment: 'x'.repeat(1000) });
    });

    it("rejects action 'MAYBE'", () => {
      expect(() => pipe.transform({ action: 'MAYBE' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects a comment over 1000 characters', () => {
      expect(() =>
        pipe.transform({ action: 'APPROVE', comment: 'x'.repeat(1001) }),
      ).toThrow(BadRequestException);
    });
  });
});
