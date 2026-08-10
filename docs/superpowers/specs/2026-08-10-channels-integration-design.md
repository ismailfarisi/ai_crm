# Multi-Channel Communication Integration Design Spec

**Date:** 2026-08-10  
**Status:** Approved  
**Topic:** Easily configurable multi-channel support (WhatsApp Cloud API, Telegram Bot, Email SMTP/Resend) with Admin Settings, Webhooks Engine, and Unified Contact Inbox.

---

## 1. Overview & Objectives

Provide a flexible, pluggable multi-channel communication engine for Relay CRM:
1. **Admin Credentials Management**: Enterprise-grade settings page (`/settings/channels`) allowing admins to easily configure, encrypt, test, and toggle channels (Meta WhatsApp Cloud API, Telegram Bot API, SMTP Email, Resend Email).
2. **Pluggable Driver Architecture**: A driver-based design in NestJS API (`apps/api`) supporting modular provider drivers.
3. **Webhooks Engine**: Public verification & event endpoints (`/api/webhooks/channels/:provider/:orgId`) matching incoming messages to CRM Contacts by phone/email/telegram handle.
4. **Unified Inbox Workspace**: Centralized conversation hub (`/inbox`) and Contact timeline tab for managing multi-channel customer communications.

---

## 2. RBAC & Data Model Design

### 2.1 RBAC Permissions (`packages/shared/src/rbac/permissions.ts`)
* `CHANNEL_MANAGE` (`channel:manage`): View, edit, test, and toggle channel configurations.
* `CHANNEL_READ` (`channel:read`): View channel message history and conversation threads.
* `CHANNEL_SEND` (`channel:send`): Compose and dispatch outbound channel messages to contacts.

### 2.2 Database Entities (`apps/api/src/modules/channels/entities/`)

#### `ChannelConfig` Entity (Table: `channel_configs`)
* `id`: UUID (Primary Key)
* `organizationId`: UUID (Multi-tenant relation)
* `provider`: Enum (`WHATSAPP_META`, `TELEGRAM`, `EMAIL_SMTP`, `EMAIL_RESEND`)
* `isEnabled`: Boolean (default `false`)
* `encryptedCredentials`: Text (AES-256-GCM encrypted JSON string containing tokens, passwords, keys)
* `webhookSecret`: String (for HMAC signature validation / Meta verify token)
* `status`: Enum (`unconfigured`, `configured`, `error`)
* `lastTestedAt`: Timestamp (Nullable)
* `createdAt`, `updatedAt`: Timestamps

#### `ChannelMessage` Entity (Table: `channel_messages`)
* `id`: UUID (Primary Key)
* `organizationId`: UUID
* `contactId`: UUID (Nullable, foreign key to `Contact`)
* `provider`: Enum (`WHATSAPP_META`, `TELEGRAM`, `EMAIL_SMTP`, `EMAIL_RESEND`)
* `direction`: Enum (`INBOUND`, `OUTBOUND`)
* `sender`: String (e.g. `+1234567890`, `john@example.com`, `@telegram_user`)
* `recipient`: String
* `body`: Text
* `metadata`: JSONB (Provider message IDs, media attachments, delivery reports)
* `status`: Enum (`pending`, `sent`, `delivered`, `failed`, `received`)
* `createdAt`: Timestamp

---

## 3. Shared Schemas (`packages/shared/src/schemas/channel.ts`)

* **WhatsApp Meta Config Schema**: `phoneNumberId`, `businessAccountId`, `accessToken`, `verifyToken`.
* **Telegram Bot Config Schema**: `botToken`, `botUsername`.
* **Email SMTP Config Schema**: `host`, `port`, `secure`, `user`, `pass`, `fromEmail`, `fromName`.
* **Email Resend Config Schema**: `apiKey`, `fromEmail`, `fromName`.
* **Send Outbound Message Schema**: `contactId`, `provider`, `body`, optional `subject`.

---

## 4. Backend Driver Architecture (`apps/api/src/modules/channels`)

### 4.1 Encryption Service (`ChannelCryptoService`)
* Encrypts sensitive channel API keys and SMTP passwords using AES-256-GCM before saving to Postgres.
* Decrypts credentials in-memory only during provider calls or webhook checks.

### 4.2 Driver Contract (`ChannelDriver` Interface)
```ts
export interface ChannelDriver {
  testConnection(credentials: Record<string, any>): Promise<{ success: boolean; message: string }>;
  sendMessage(credentials: Record<string, any>, payload: OutboundPayload): Promise<{ externalId?: string; rawResponse?: any }>;
  parseWebhookPayload(credentials: Record<string, any>, headers: any, body: any): Promise<ParsedWebhookMessage | null>;
}
```

### 4.3 Drivers Implementation
1. **`MetaWhatsAppDriver`**: Integrates Meta WhatsApp Cloud API (`https://graph.facebook.com/v19.0/{phone_number_id}/messages`). Handles webhook verification challenge (`hub.challenge`) and incoming text/media notifications.
2. **`TelegramDriver`**: Integrates Telegram Bot API (`sendMessage`, `getMe`). Processes incoming bot updates (`message.chat.id`, `message.text`).
3. **`EmailSmtpDriver`**: Integrates `nodemailer` for SMTP transport verification and outbound email delivery.
4. **`EmailResendDriver`**: Integrates Resend API (`api.resend.com/emails`).

### 4.4 Inbound Webhooks (`ChannelWebhooksController`)
* Endpoint: `POST /api/webhooks/channels/:provider/:orgId`
* Verifies provider signature/token.
* Extracts sender identifier (phone, email, telegram user ID).
* Resolves existing Contact via `ContactsService.scoped()`. If no contact exists, creates a new Contact entry.
* Saves `ChannelMessage` with `direction = INBOUND` and `status = received`.

---

## 5. Frontend UI Design (`apps/web`)

### 5.1 Admin Channel Settings (`/settings/channels`)
* Responsive cards for WhatsApp Cloud API, Telegram Bot, SMTP Email, Resend Email.
* Credential configuration modals with masked secret inputs.
* **Test Connection Button**: Invokes `/api/channels/:provider/test` backend endpoint and displays immediate success toast or error description.
* **Webhook Copy Tool**: Displays the exact webhook URL to paste into Meta / Telegram / Email webhooks.
* Guarded by `channel:manage` permission.

### 5.2 Unified Inbox Workspace (`/inbox`)
* **Left Panel**: Filterable contact chat threads by channel (`All`, `WhatsApp`, `Telegram`, `Email`).
* **Center Panel**: Conversational message history with delivery statuses (`Sent`, `Delivered`, `Failed`, `Received`).
* **Composer**: Channel dropdown selector + text editor + send button.

### 5.3 Contact Detail Messages Tab (`/contacts/[id]`)
* Shows a unified timeline of all channel interactions with the contact.
* Includes quick compose reply box.

---

## 6. Verification & Test Plan

1. **Unit & Driver Tests**: Test credential encryption/decryption, Zod schemas, and mock provider driver implementations.
2. **API Integration Tests**: Test `POST /channels/:provider/config`, `POST /channels/:provider/test`, and `POST /channels/send`.
3. **Webhook Tests**: Simulate Meta WhatsApp and Telegram incoming message webhooks to verify auto-contact resolution and message logging.
4. **Frontend UI E2E / Manual Verification**: Verify admin channel setup, connection testing, inbox workspace rendering, and contact detail messages tab.
