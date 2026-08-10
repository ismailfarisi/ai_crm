import { z } from 'zod';

export const ChannelProviderEnum = z.enum([
  'WHATSAPP_META',
  'TELEGRAM',
  'EMAIL_SMTP',
  'EMAIL_RESEND',
]);
export type ChannelProvider = z.infer<typeof ChannelProviderEnum>;

export const metaWhatsAppConfigSchema = z.object({
  phoneNumberId: z.string().min(1, 'Phone Number ID is required'),
  businessAccountId: z.string().min(1, 'Business Account ID is required'),
  accessToken: z.string().min(1, 'Access Token is required'),
  verifyToken: z.string().min(1, 'Verify Token is required'),
});

export const telegramConfigSchema = z.object({
  botToken: z.string().min(1, 'Bot Token is required'),
  botUsername: z.string().min(1, 'Bot Username is required'),
});

export const emailSmtpConfigSchema = z.object({
  host: z.string().min(1, 'SMTP Host is required'),
  port: z.number().int().positive(),
  secure: z.boolean().default(true),
  user: z.string().min(1, 'SMTP User is required'),
  pass: z.string().min(1, 'SMTP Password is required'),
  fromEmail: z.string().email(),
  fromName: z.string().min(1),
});

export const emailResendConfigSchema = z.object({
  apiKey: z.string().min(1, 'Resend API Key is required'),
  fromEmail: z.string().email(),
  fromName: z.string().min(1),
});

export const channelConfigSchema = z.union([
  metaWhatsAppConfigSchema,
  telegramConfigSchema,
  emailSmtpConfigSchema,
  emailResendConfigSchema,
]);

export const sendChannelMessageSchema = z.object({
  contactId: z.string().uuid().optional(),
  provider: ChannelProviderEnum,
  recipient: z.string().min(1),
  body: z.string().min(1, 'Message body is required'),
  subject: z.string().optional(),
});

export type MetaWhatsAppConfig = z.infer<typeof metaWhatsAppConfigSchema>;
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
export type EmailSmtpConfig = z.infer<typeof emailSmtpConfigSchema>;
export type EmailResendConfig = z.infer<typeof emailResendConfigSchema>;
export type ChannelConfigPayload = z.infer<typeof channelConfigSchema>;
export type SendChannelMessagePayload = z.infer<typeof sendChannelMessageSchema>;
