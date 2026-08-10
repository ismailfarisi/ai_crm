# Multi-Channel Communication Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-configurable multi-channel communication suite (WhatsApp Cloud API, Telegram Bot, SMTP/Resend Email) with secure credential encryption, public webhook handlers, and a unified contact inbox.

**Architecture:** A pluggable `ChannelDriver` system in NestJS API (`apps/api`), AES-256 encrypted `ChannelConfig` and `ChannelMessage` entities in PostgreSQL via TypeORM, shared RBAC permissions and Zod validation schemas in `@saas/shared`, public webhook controllers `/api/webhooks/channels/:provider/:orgId` for inbound contact resolution, and Next.js 16 UI for Admin Settings (`/settings/channels`), Unified Inbox (`/inbox`), and Contact Timeline.

**Tech Stack:** NestJS 11, TypeORM 1, Next.js 16 App Router, `@saas/shared`, Zod, `nodemailer`, PostgreSQL.

## Global Constraints
- Permissions live in `packages/shared/src/rbac/permissions.ts` and nowhere else.
- Shared package must be built (`pnpm --filter @saas/shared build`) before API or Web can consume changes.
- Every DB change requires TypeORM entity definition and generated migration.
- Route protection lives in `src/proxy.ts` (Next.js 16).

---

### Task 1: Shared RBAC Permissions & Channel Schemas

**Files:**
- Modify: `packages/shared/src/rbac/permissions.ts`
- Create: `packages/shared/src/schemas/channel.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/rbac/permissions.spec.ts`

**Interfaces:**
- Consumes: Existing RBAC structure in `packages/shared`
- Produces: `CHANNEL_MANAGE`, `CHANNEL_READ`, `CHANNEL_SEND`, `channelConfigSchema`, `metaWhatsAppConfigSchema`, `telegramConfigSchema`, `emailSmtpConfigSchema`, `emailResendConfigSchema`, `sendChannelMessageSchema`

- [ ] **Step 1: Write permission & schema tests**

```ts
// packages/shared/src/rbac/permissions.spec.ts
import { PERMISSIONS } from './permissions';
import { metaWhatsAppConfigSchema, telegramConfigSchema } from '../schemas/channel';

describe('Channel Permissions & Schemas', () => {
  it('should include channel permissions in PERMISSIONS catalog', () => {
    expect(PERMISSIONS.CHANNEL_MANAGE).toBe('channel:manage');
    expect(PERMISSIONS.CHANNEL_READ).toBe('channel:read');
    expect(PERMISSIONS.CHANNEL_SEND).toBe('channel:send');
  });

  it('should validate Meta WhatsApp credentials payload', () => {
    const valid = metaWhatsAppConfigSchema.safeParse({
      phoneNumberId: '123456789',
      businessAccountId: '987654321',
      accessToken: 'EAAG...',
      verifyToken: 'my-secret-verify-token',
    });
    expect(valid.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test`
Expected: FAIL with missing exports.

- [ ] **Step 3: Implement permissions and Zod schemas**

Add to `packages/shared/src/rbac/permissions.ts`:
```ts
export const PERMISSIONS = {
  // ... existing permissions ...
  CHANNEL_MANAGE: 'channel:manage',
  CHANNEL_READ: 'channel:read',
  CHANNEL_SEND: 'channel:send',
} as const;
```

Create `packages/shared/src/schemas/channel.ts`:
```ts
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

export const sendChannelMessageSchema = z.object({
  contactId: z.string().uuid().optional(),
  provider: ChannelProviderEnum,
  recipient: z.string().min(1),
  body: z.string().min(1, 'Message body is required'),
  subject: z.string().optional(),
});
```

Export `channel.ts` from `packages/shared/src/index.ts`.

- [ ] **Step 4: Build shared package and run tests**

Run: `pnpm --filter @saas/shared build && pnpm --filter @saas/shared test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add channel RBAC permissions and validation schemas"
```

---

### Task 2: TypeORM Entities & Database Migration (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/channels/entities/channel-config.entity.ts`
- Create: `apps/api/src/modules/channels/entities/channel-message.entity.ts`
- Create Migration: `apps/api/src/database/migrations/1723284000000-CreateChannelsTables.ts`
- Modify: `apps/api/src/database/data-source.ts` (or registered entities list)

**Interfaces:**
- Consumes: `@saas/shared` ChannelProvider types
- Produces: `ChannelConfig` and `ChannelMessage` entities

- [ ] **Step 1: Create `ChannelConfig` entity**

```ts
// apps/api/src/modules/channels/entities/channel-config.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

export enum ChannelProviderType {
  WHATSAPP_META = 'WHATSAPP_META',
  TELEGRAM = 'TELEGRAM',
  EMAIL_SMTP = 'EMAIL_SMTP',
  EMAIL_RESEND = 'EMAIL_RESEND',
}

export enum ChannelStatus {
  UNCONFIGURED = 'unconfigured',
  CONFIGURED = 'configured',
  ERROR = 'error',
}

@Entity('channel_configs')
@Unique(['organizationId', 'provider'])
export class ChannelConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column({ type: 'enum', enum: ChannelProviderType })
  provider: ChannelProviderType;

  @Column({ type: 'boolean', default: false })
  isEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  encryptedCredentials: string | null;

  @Column({ type: 'varchar', nullable: true })
  webhookSecret: string | null;

  @Column({ type: 'enum', enum: ChannelStatus, default: ChannelStatus.UNCONFIGURED })
  status: ChannelStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastTestedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Create `ChannelMessage` entity**

```ts
// apps/api/src/modules/channels/entities/channel-message.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { ChannelProviderType } from './channel-config.entity';
import { Contact } from '../../contacts/entities/contact.entity';

export enum MessageDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum MessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  RECEIVED = 'received',
}

@Entity('channel_messages')
export class ChannelMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  contactId: string | null;

  @ManyToOne(() => Contact, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'contactId' })
  contact: Contact | null;

  @Column({ type: 'enum', enum: ChannelProviderType })
  provider: ChannelProviderType;

  @Column({ type: 'enum', enum: MessageDirection })
  direction: MessageDirection;

  @Column({ type: 'varchar', length: 255 })
  sender: string;

  @Column({ type: 'varchar', length: 255 })
  recipient: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.PENDING })
  status: MessageStatus;

  @CreateDateColumn()
  @Index()
  createdAt: Date;
}
```

- [ ] **Step 3: Register entities and generate migration**

Run: `pnpm --filter @saas/api migration:generate CreateChannelsTables`
Expected: Migration generated under `apps/api/src/database/migrations/`.

- [ ] **Step 4: Run migration and verify schema**

Run: `pnpm --filter @saas/api migration:run`
Expected: PASS with 0 drift.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels/entities apps/api/src/database/migrations
git commit -m "feat(api): create channel_configs and channel_messages entities and migrations"
```

---

### Task 3: Credential Encryption & Channel Driver Interface (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/channels/services/channel-crypto.service.ts`
- Create: `apps/api/src/modules/channels/interfaces/channel-driver.interface.ts`
- Test: `apps/api/src/modules/channels/services/channel-crypto.service.spec.ts`

**Interfaces:**
- Consumes: Node `crypto` AES-256-GCM
- Produces: `ChannelCryptoService.encrypt()`, `ChannelCryptoService.decrypt()`, `ChannelDriver`

- [ ] **Step 1: Write test for `ChannelCryptoService`**

```ts
// apps/api/src/modules/channels/services/channel-crypto.service.spec.ts
import { ChannelCryptoService } from './channel-crypto.service';

describe('ChannelCryptoService', () => {
  let service: ChannelCryptoService;

  beforeEach(() => {
    service = new ChannelCryptoService('secret-key-32-characters-length!!');
  });

  it('should encrypt and decrypt credentials JSON cleanly', () => {
    const payload = { botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11' };
    const encrypted = service.encrypt(payload);
    expect(encrypted).not.toContain('123456:ABC-DEF');

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/api test apps/api/src/modules/channels/services/channel-crypto.service.spec.ts`
Expected: FAIL with "ChannelCryptoService not defined".

- [ ] **Step 3: Implement `ChannelCryptoService` and `ChannelDriver` interface**

Create `apps/api/src/modules/channels/services/channel-crypto.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class ChannelCryptoService {
  private readonly key: Buffer;

  constructor(secretKey?: string) {
    const secret = secretKey || process.env.APP_SECRET || 'default-secret-key-at-least-32-chars-long!';
    this.key = Buffer.from(secret.padEnd(32, '0').slice(0, 32));
  }

  encrypt(data: Record<string, any>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const jsonStr = JSON.stringify(data);
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt<T = Record<string, any>>(encryptedStr: string): T {
    const [ivHex, authTagHex, encryptedText] = encryptedStr.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted) as T;
  }
}
```

Create `apps/api/src/modules/channels/interfaces/channel-driver.interface.ts`:
```ts
export interface OutboundPayload {
  recipient: string;
  body: string;
  subject?: string;
}

export interface ParsedWebhookMessage {
  senderIdentifier: string;
  body: string;
  externalMessageId?: string;
  rawPayload: Record<string, any>;
}

export interface ChannelDriver {
  testConnection(credentials: Record<string, any>): Promise<{ success: boolean; message: string }>;
  sendMessage(credentials: Record<string, any>, payload: OutboundPayload): Promise<{ externalId?: string; rawResponse?: any }>;
  parseWebhookPayload(credentials: Record<string, any>, headers: any, body: any): Promise<ParsedWebhookMessage | null>;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @saas/api test apps/api/src/modules/channels/services/channel-crypto.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels/services apps/api/src/modules/channels/interfaces
git commit -m "feat(api): add channel encryption service and driver interface"
```

---

### Task 4: Channel Driver Implementations (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/channels/drivers/meta-whatsapp.driver.ts`
- Create: `apps/api/src/modules/channels/drivers/telegram.driver.ts`
- Create: `apps/api/src/modules/channels/drivers/email-smtp.driver.ts`
- Create: `apps/api/src/modules/channels/drivers/email-resend.driver.ts`
- Test: `apps/api/src/modules/channels/drivers/drivers.spec.ts`

**Interfaces:**
- Consumes: Meta Graph API, Telegram API, `nodemailer`, Resend API
- Produces: Drivers implementing `ChannelDriver`

- [ ] **Step 1: Implement `TelegramDriver` & `MetaWhatsAppDriver`**

Create `apps/api/src/modules/channels/drivers/telegram.driver.ts`:
```ts
import { ChannelDriver, OutboundPayload, ParsedWebhookMessage } from '../interfaces/channel-driver.interface';

export class TelegramDriver implements ChannelDriver {
  async testConnection(credentials: Record<string, any>): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${credentials.botToken}/getMe`);
      const data = await res.json();
      if (data.ok) {
        return { success: true, message: `Connected to Telegram bot @${data.result.username}` };
      }
      return { success: false, message: data.description || 'Telegram auth failed' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async sendMessage(credentials: Record<string, any>, payload: OutboundPayload) {
    const res = await fetch(`https://api.telegram.org/bot${credentials.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: payload.recipient, text: payload.body }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || 'Failed to send Telegram message');
    return { externalId: String(data.result.message_id), rawResponse: data };
  }

  async parseWebhookPayload(_credentials: Record<string, any>, _headers: any, body: any): Promise<ParsedWebhookMessage | null> {
    if (!body?.message?.text) return null;
    return {
      senderIdentifier: String(body.message.chat.id),
      body: body.message.text,
      externalMessageId: String(body.message.message_id),
      rawPayload: body,
    };
  }
}
```

Create `apps/api/src/modules/channels/drivers/meta-whatsapp.driver.ts`, `email-smtp.driver.ts`, `email-resend.driver.ts`.

- [ ] **Step 2: Write tests for Drivers**

```ts
// apps/api/src/modules/channels/drivers/drivers.spec.ts
import { TelegramDriver } from './telegram.driver';

describe('TelegramDriver', () => {
  it('should parse valid telegram webhook payload', async () => {
    const driver = new TelegramDriver();
    const payload = {
      message: {
        message_id: 999,
        chat: { id: 12345678 },
        text: 'Hello CRM!',
      },
    };
    const parsed = await driver.parseWebhookPayload({}, {}, payload);
    expect(parsed).toEqual({
      senderIdentifier: '12345678',
      body: 'Hello CRM!',
      externalMessageId: '999',
      rawPayload: payload,
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @saas/api test apps/api/src/modules/channels/drivers/drivers.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/channels/drivers
git commit -m "feat(api): add WhatsApp, Telegram, SMTP, and Resend channel drivers"
```

---

### Task 5: Channels API Service, Controller & Module (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/channels/channels.service.ts`
- Create: `apps/api/src/modules/channels/channels.controller.ts`
- Create: `apps/api/src/modules/channels/channels.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/channels/channels.service.spec.ts`

**Interfaces:**
- Consumes: `ChannelConfig`, `ChannelMessage`, `ChannelCryptoService`, Drivers
- Produces: REST Endpoints `/channels/configs`, `/channels/:provider/test`, `/channels/messages`, `/channels/send`

- [ ] **Step 1: Implement `ChannelsService`**

`ChannelsService` will:
- `getConfig(orgId, provider)` / `saveConfig(orgId, provider, dto)`
- `testConnection(orgId, provider)`
- `sendMessage(orgId, actorId, dto)`
- `getMessagesForContact(orgId, contactId)`

- [ ] **Step 2: Implement `ChannelsController` with RBAC Guards**

```ts
@Controller('channels')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ChannelsController {
  @Get('configs')
  @Permissions(PERMISSIONS.CHANNEL_READ)
  getConfigs(@Req() req) { ... }

  @Post('configs/:provider')
  @Permissions(PERMISSIONS.CHANNEL_MANAGE)
  saveConfig(@Req() req, @Param('provider') provider, @Body() body) { ... }

  @Post('configs/:provider/test')
  @Permissions(PERMISSIONS.CHANNEL_MANAGE)
  testConfig(@Req() req, @Param('provider') provider) { ... }

  @Post('send')
  @Permissions(PERMISSIONS.CHANNEL_SEND)
  sendMessage(@Req() req, @Body() body) { ... }
}
```

- [ ] **Step 3: Register `ChannelsModule` in `AppModule`**

- [ ] **Step 4: Run module tests**

Run: `pnpm --filter @saas/api test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels
git commit -m "feat(api): add ChannelsService, ChannelsController, and NestJS module"
```

---

### Task 6: Channels Public Webhooks Controller (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/channels/channels-webhook.controller.ts`
- Modify: `apps/api/src/modules/channels/channels.module.ts`
- Test: `apps/api/src/modules/channels/channels-webhook.controller.spec.ts`

**Interfaces:**
- Consumes: Public Webhook payloads from WhatsApp/Telegram
- Produces: `GET /api/webhooks/channels/whatsapp/:orgId` (Challenge verify), `POST /api/webhooks/channels/:provider/:orgId` (Inbound message handler)

- [ ] **Step 1: Implement Meta verification & Inbound Webhook handler**

```ts
@Controller('webhooks/channels')
export class ChannelsWebhookController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get('whatsapp/:orgId')
  verifyMetaWebhook(@Param('orgId') orgId: string, @Query() query: any) {
    return this.channelsService.verifyMetaChallenge(orgId, query['hub.mode'], query['hub.verify_token'], query['hub.challenge']);
  }

  @Post(':provider/:orgId')
  async handleInboundWebhook(@Param('provider') provider: ChannelProviderType, @Param('orgId') orgId: string, @Headers() headers: any, @Body() body: any) {
    return this.channelsService.processInboundWebhook(orgId, provider, headers, body);
  }
}
```

- [ ] **Step 2: Test Contact auto-resolution logic**

- [ ] **Step 3: Run API tests**

Run: `pnpm --filter @saas/api test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/channels
git commit -m "feat(api): add public channel webhooks controller and contact resolution"
```

---

### Task 7: Admin Channels Settings UI (`apps/web`)

**Files:**
- Create: `apps/web/src/app/(app)/settings/channels/page.tsx`
- Create: `apps/web/src/components/channels/channel-card.tsx`
- Create: `apps/web/src/components/channels/channel-config-modal.tsx`
- Modify: Navigation link in settings sidebar/header

**Interfaces:**
- Consumes: `/channels/configs`, `/channels/configs/:provider`, `/channels/configs/:provider/test`
- Produces: Admin channels configuration dashboard UI

- [ ] **Step 1: Build `ChannelCard` & `ChannelConfigModal` components**

Components present form fields with test connection button and toast alerts for result.

- [ ] **Step 2: Build `/settings/channels` page**

Guarded by permission check `channel:manage`.

- [ ] **Step 3: Run web build check**

Run: `pnpm --filter @saas/web build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/settings/channels apps/web/src/components/channels
git commit -m "feat(web): add admin channels settings page and credentials modal"
```

---

### Task 8: Unified Inbox & Contact Timeline Tab UI (`apps/web`)

**Files:**
- Create: `apps/web/src/app/(app)/inbox/page.tsx`
- Create: `apps/web/src/components/inbox/inbox-chat.tsx`
- Create: `apps/web/src/components/contacts/contact-messages-tab.tsx`
- Modify: `apps/web/src/app/(app)/contacts/[id]/page.tsx`

**Interfaces:**
- Consumes: `/channels/messages`, `/channels/send`
- Produces: Unified Inbox workspace and Contact messages timeline UI

- [ ] **Step 1: Build `InboxChat` workspace**

Renders contact list, thread conversation history, and multi-channel send composer.

- [ ] **Step 2: Build `ContactMessagesTab`**

Add "Messages" tab to contact detail page.

- [ ] **Step 3: Run full verification build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/inbox apps/web/src/components/inbox apps/web/src/components/contacts
git commit -m "feat(web): add unified inbox workspace and contact messages timeline tab"
```
