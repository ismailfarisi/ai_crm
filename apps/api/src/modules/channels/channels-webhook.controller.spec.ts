import { Test, TestingModule } from '@nestjs/testing';
import { ChannelsWebhookController } from './channels-webhook.controller';
import { ChannelsService } from './channels.service';
import { ChannelProviderType } from './entities/channel-config.entity';

describe('ChannelsWebhookController', () => {
  let controller: ChannelsWebhookController;
  let channelsService: jest.Mocked<Partial<ChannelsService>>;

  beforeEach(async () => {
    channelsService = {
      verifyMetaChallenge: jest.fn(),
      processInboundWebhook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChannelsWebhookController],
      providers: [
        {
          provide: ChannelsService,
          useValue: channelsService,
        },
      ],
    }).compile();

    controller = module.get<ChannelsWebhookController>(
      ChannelsWebhookController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('verifyMetaWebhook', () => {
    it('delegates to channelsService.verifyMetaChallenge', async () => {
      (channelsService.verifyMetaChallenge as jest.Mock).mockResolvedValue(
        'challenge_ok',
      );

      const result = await controller.verifyMetaWebhook(
        'org-123',
        'subscribe',
        'my_token',
        'challenge_ok',
      );

      expect(channelsService.verifyMetaChallenge).toHaveBeenCalledWith(
        'org-123',
        'subscribe',
        'my_token',
        'challenge_ok',
      );
      expect(result).toBe('challenge_ok');
    });
  });

  describe('handleInboundWebhook', () => {
    it('delegates to channelsService.processInboundWebhook', async () => {
      (channelsService.processInboundWebhook as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'msg-456',
      });

      const result = await controller.handleInboundWebhook(
        ChannelProviderType.TELEGRAM,
        'org-123',
        { 'content-type': 'application/json' },
        { message: { text: 'hello' } },
      );

      expect(channelsService.processInboundWebhook).toHaveBeenCalledWith(
        'org-123',
        ChannelProviderType.TELEGRAM,
        { 'content-type': 'application/json' },
        { message: { text: 'hello' } },
      );
      expect(result).toEqual({ success: true, messageId: 'msg-456' });
    });
  });
});
