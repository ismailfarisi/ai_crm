# Email Client Integration — Design Document

## Overview
This design document defines the specification for building a full-featured 2-way Email Client inside Relay CRM (`ismailfarisi/ai_crm`). The email client operates in Dual Mode: providing a dedicated full-featured 3-pane email workspace (`/email`) for email management, while integrating email conversation threads directly into the shared multi-channel inbox (`/inbox`) and CRM contact activity feeds.

---

## 1. System Architecture & Database Schema

### 1.1 DB Entities (`apps/api/src/modules/email/entities`)

#### `EmailAccount` (`email_accounts`)
Stores connection credentials and configuration for connected email accounts (IMAP/SMTP/Resend).
- `id`: `uuid` (Primary Key)
- `organizationId`: `uuid` (Tenant scoping index)
- `userId`: `uuid` (Owner user ID)
- `name`: `varchar(255)` (Account label, e.g. "Sales Support")
- `emailAddress`: `varchar(255)`
- `providerType`: `enum('RESEND', 'SMTP_IMAP', 'GMAIL_OAUTH')`
- `inboundType`: `enum('WEBHOOK', 'IMAP', 'NONE')`
- `encryptedSmtpConfig`: `text` (Encrypted JSON: host, port, username, password, tls)
- `encryptedImapConfig`: `text` (Encrypted JSON: host, port, username, password, tls)
- `isShared`: `boolean` (Default: `false`. If true, accessible by all org members with `email:read_all`)
- `syncStatus`: `enum('ACTIVE', 'ERROR', 'PAUSED')`
- `lastSyncedAt`: `timestamp with time zone` (Nullable)
- `createdAt`: `timestamp with time zone`
- `updatedAt`: `timestamp with time zone`

#### `EmailThread` (`email_threads`)
Represents an email conversation thread.
- `id`: `uuid` (Primary Key)
- `organizationId`: `uuid` (Tenant scoping index)
- `emailAccountId`: `uuid` (FK to `EmailAccount`)
- `contactId`: `uuid` (Nullable, FK to `Contact` auto-linked by email matching)
- `subject`: `varchar(500)`
- `snippet`: `text` (First 150 characters preview)
- `folder`: `enum('INBOX', 'SENT', 'DRAFTS', 'TRASH', 'ARCHIVE', 'SPAM')`
- `isStarred`: `boolean` (Default: `false`)
- `isRead`: `boolean` (Default: `false`)
- `participantEmails`: `jsonb` (Array of email addresses involved in thread)
- `lastMessageAt`: `timestamp with time zone`
- `messageCount`: `integer` (Default: 1)
- `createdAt`: `timestamp with time zone`
- `updatedAt`: `timestamp with time zone`

#### `EmailMessage` (`email_messages`)
Stores individual email messages within a thread.
- `id`: `uuid` (Primary Key)
- `organizationId`: `uuid` (Tenant scoping index)
- `threadId`: `uuid` (FK to `EmailThread`)
- `messageIdHeader`: `varchar(255)` (RFC822 `Message-ID`)
- `inReplyToHeader`: `varchar(255)` (Nullable, RFC822 `In-Reply-To`)
- `referencesHeaders`: `jsonb` (Array of parent RFC822 `References`)
- `direction`: `enum('INBOUND', 'OUTBOUND')`
- `fromEmail`: `varchar(255)`
- `fromName`: `varchar(255)`
- `toEmails`: `jsonb` (Array of `{ name: string, email: string }`)
- `ccEmails`: `jsonb` (Array of `{ name: string, email: string }`)
- `bccEmails`: `jsonb` (Array of `{ name: string, email: string }`)
- `subject`: `varchar(500)`
- `bodyHtml`: `text`
- `bodyText`: `text`
- `hasAttachments`: `boolean` (Default: `false`)
- `status`: `enum('DRAFT', 'PENDING', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED')`
- `createdAt`: `timestamp with time zone`

#### `EmailAttachment` (`email_attachments`)
Stores file attachments linked to email messages.
- `id`: `uuid` (Primary Key)
- `emailMessageId`: `uuid` (FK to `EmailMessage`)
- `filename`: `varchar(255)`
- `mimeType`: `varchar(100)`
- `sizeBytes`: `integer`
- `storageUrl`: `varchar(500)`
- `createdAt`: `timestamp with time zone`

---

## 2. Ingestion, Threading & Outbound Delivery Engine

### 2.1 Inbound Webhook & IMAP Sync Worker
- **Webhook Ingestion (`POST /api/v1/email/webhooks/:provider`)**:
  - Validates provider signature or webhook token.
  - Normalizes payload into standard email DTO.
  - Extracts RFC822 headers (`Message-ID`, `In-Reply-To`, `References`).
- **IMAP Worker Service (`EmailImapService`)**:
  - Connects to IMAP accounts using `imapflow` or `imapsimple`.
  - Searches for unseen messages since `lastSyncedAt`.
  - Parses MIME structure using `mailparser`.
  - Saves attachments to local storage / S3 bucket and updates DB records.

### 2.2 Threading Algorithm
1. **RFC822 Header Check**: Look up `inReplyToHeader` or elements in `referencesHeaders` in `EmailMessage`. If matched, append message to that message's `threadId`.
2. **Subject & Participant Matching Fallback**: If no header match exists, query `EmailThread` for normalized subject (`Re:`, `Fwd:` stripped) and matching participant email address within the last 30 days.
3. **New Thread Fallback**: If no match, instantiate new `EmailThread` with `folder = INBOX`.

### 2.3 CRM Contact Auto-Association
- On message creation, query `contacts` table by `organizationId` and email address matching `fromEmail` (inbound) or `toEmails` (outbound).
- If match exists, set `EmailThread.contactId = contact.id`.

### 2.4 Outbound Sending & Draft Saving
- **Nodemailer / Resend Dispatch**: Construct MIME body with HTML formatting and attachments.
- **Draft Auto-save**: Autosave endpoint (`POST /api/v1/email/drafts`) updates or inserts an `EmailMessage` with `status = DRAFT`.

---

## 3. RBAC Permissions & API Security

### 3.1 Permissions (`packages/shared/src/rbac/permissions.ts`)
- `EMAIL_READ`: `'email:read'` — View email accounts & assigned threads.
- `EMAIL_READ_ALL`: `'email:read_all'` — View all organization email accounts and threads.
- `EMAIL_SEND`: `'email:send'` — Compose, reply, forward, and manage drafts.
- `EMAIL_MANAGE`: `'email:manage'` — Add, update, or remove connected IMAP/SMTP/Resend accounts.

Registered under the `"email"` group in `PERMISSION_GROUPS`.

### 3.2 Tenant Isolation & Scoping
- All service methods enforce `organizationId` scoping.
- Shared accounts are visible to all users with `EMAIL_READ_ALL`; private accounts are restricted to owner `userId`.

---

## 4. REST API Endpoints (`apps/api/src/modules/email`)

- `GET /api/v1/email/accounts` — List connected email accounts
- `POST /api/v1/email/accounts` — Create/connect email account
- `DELETE /api/v1/email/accounts/:id` — Disconnect email account
- `GET /api/v1/email/threads` — List email threads (query params: `folder`, `search`, `account_id`, `page`, `limit`)
- `GET /api/v1/email/threads/:id` — Get thread details with all messages
- `PATCH /api/v1/email/threads/:id` — Update thread metadata (`folder`, `isStarred`, `isRead`)
- `POST /api/v1/email/messages/send` — Send email or reply
- `POST /api/v1/email/drafts` — Create/update draft
- `POST /api/v1/email/webhooks/:provider` — Public inbound webhook endpoint

---

## 5. Frontend UI/UX Specification (`apps/web`)

### 5.1 Route Structure
- `/email`: Standalone 3-pane email workspace.
- `/inbox`: Multi-channel unified inbox with rich email view.
- `/contacts/[id]`: Contact detail page featuring an **"Emails"** tab.

### 5.2 Standalone Workspace (`/email`)
- **Left Navigation**: Folders (`Inbox`, `Starred`, `Sent`, `Drafts`, `Archive`, `Trash`), Account Switcher, Compose Button.
- **Middle List**: Search & filter bar, thread items with avatars, badges, snippet, timestamp, and star toggle.
- **Right Reader/Composer**:
  - Message thread display with sanitized HTML iframe rendering.
  - Linked CRM contact badge with quick-view drawer.
  - Inline reply/forward composer with rich formatting bar, attachment uploader, and auto-draft status indicator.

---

## 6. Implementation Milestones

1. **Shared RBAC & DTOs**: Add `EMAIL_*` permissions to `@saas/shared`.
2. **Backend Database Entities**: Create `EmailAccount`, `EmailThread`, `EmailMessage`, `EmailAttachment` TypeORM entities and migration.
3. **Backend Email Module**: Implement `EmailService`, `EmailController`, Webhook handler, and IMAP/SMTP drivers.
4. **Frontend API Client & Components**: Build `/email` 3-pane layout, rich text composer, and `/inbox` email view components.
5. **Testing & Verification**: Integration tests for email ingestion, threading, sending, and contact auto-linking.
