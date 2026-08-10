# Integrated 2-Way Email Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-featured 2-way Email Client inside Relay CRM (`ismailfarisi/ai_crm`) with standalone 3-pane email workspace (`/email`), RFC822 message threading, contact auto-association, and multi-channel `/inbox` email view.

**Architecture:** A NestJS + TypeORM backend module (`apps/api/src/modules/email`) managing `EmailAccount`, `EmailThread`, `EmailMessage`, and `EmailAttachment` entities, supporting webhook-based and IMAP ingestion + SMTP/Resend outbound delivery. Shared permissions in `@saas/shared`. React/Next.js 16 frontend at `apps/web/src/app/(app)/email`.

**Tech Stack:** NestJS 11, TypeORM 1, PostgreSQL 18, `@saas/shared`, Next.js 16 App Router, React 19, Lucide React icons, Tailwind CSS / Vanilla CSS.

## Global Constraints

- Permissions MUST live in `packages/shared/src/rbac/permissions.ts` first.
- Rebuild `@saas/shared` via `pnpm --filter @saas/shared build` after permission changes.
- Scoped tenant isolation enforced in service layer (`organizationId`).
- Schema changes owned by TypeORM migrations (`pnpm migration:generate` & `pnpm migration:run`).

---

### Task 1: Shared RBAC Permissions & Constants

**Files:**
- Modify: `packages/shared/src/rbac/permissions.ts`
- Test: Build `@saas/shared` package via `pnpm --filter @saas/shared build`

**Interfaces:**
- Produces: `PERMISSIONS.EMAIL_READ`, `PERMISSIONS.EMAIL_READ_ALL`, `PERMISSIONS.EMAIL_SEND`, `PERMISSIONS.EMAIL_MANAGE`

- [ ] **Step 1: Add Email Permission Constants to `@saas/shared`**

Add permission keys in `packages/shared/src/rbac/permissions.ts`:
```typescript
  // Email Client
  EMAIL_READ: 'email:read',
  EMAIL_READ_ALL: 'email:read_all',
  EMAIL_SEND: 'email:send',
  EMAIL_MANAGE: 'email:manage',
```
And add human-readable descriptions and group entry in `PERMISSION_DESCRIPTIONS` and `PERMISSION_GROUPS`.

- [ ] **Step 2: Build `@saas/shared`**

Run: `pnpm --filter @saas/shared build`
Expected: Successful build producing updated `dist/`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/rbac/permissions.ts
git commit -m "feat(shared): add email client permissions"
```

---

### Task 2: Backend Email Database Entities

**Files:**
- Create: `apps/api/src/modules/email/entities/email-account.entity.ts`
- Create: `apps/api/src/modules/email/entities/email-thread.entity.ts`
- Create: `apps/api/src/modules/email/entities/email-message.entity.ts`
- Create: `apps/api/src/modules/email/entities/email-attachment.entity.ts`
- Create: `apps/api/src/modules/email/entities/index.ts`

**Interfaces:**
- Produces: `EmailAccount`, `EmailThread`, `EmailMessage`, `EmailAttachment` TypeORM entities.

- [ ] **Step 1: Create `EmailAccount` Entity**

Create `apps/api/src/modules/email/entities/email-account.entity.ts`:
```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum EmailProviderType {
  RESEND = 'RESEND',
  SMTP_IMAP = 'SMTP_IMAP',
  GMAIL_OAUTH = 'GMAIL_OAUTH',
}

export enum EmailInboundType {
  WEBHOOK = 'WEBHOOK',
  IMAP = 'IMAP',
  NONE = 'NONE',
}

export enum EmailSyncStatus {
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR',
  PAUSED = 'PAUSED',
}

@Entity('email_accounts')
export class EmailAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column('uuid')
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  emailAddress: string;

  @Column({ type: 'enum', enum: EmailProviderType, default: EmailProviderType.RESEND })
  providerType: EmailProviderType;

  @Column({ type: 'enum', enum: EmailInboundType, default: EmailInboundType.WEBHOOK })
  inboundType: EmailInboundType;

  @Column({ type: 'text', nullable: true })
  encryptedSmtpConfig: string | null;

  @Column({ type: 'text', nullable: true })
  encryptedImapConfig: string | null;

  @Column({ type: 'boolean', default: false })
  isShared: boolean;

  @Column({ type: 'enum', enum: EmailSyncStatus, default: EmailSyncStatus.ACTIVE })
  syncStatus: EmailSyncStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Create `EmailThread` Entity**

Create `apps/api/src/modules/email/entities/email-thread.entity.ts`:
```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contact } from '../../contacts/entities/contact.entity';
import { EmailAccount } from './email-account.entity';

export enum EmailFolder {
  INBOX = 'INBOX',
  SENT = 'SENT',
  DRAFTS = 'DRAFTS',
  TRASH = 'TRASH',
  ARCHIVE = 'ARCHIVE',
  SPAM = 'SPAM',
}

@Entity('email_threads')
export class EmailThread {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column('uuid')
  @Index()
  emailAccountId: string;

  @ManyToOne(() => EmailAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'emailAccountId' })
  emailAccount: EmailAccount;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  contactId: string | null;

  @ManyToOne(() => Contact, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'contactId' })
  contact: Contact | null;

  @Column({ type: 'varchar', length: 500 })
  subject: string;

  @Column({ type: 'text', default: '' })
  snippet: string;

  @Column({ type: 'enum', enum: EmailFolder, default: EmailFolder.INBOX })
  @Index()
  folder: EmailFolder;

  @Column({ type: 'boolean', default: false })
  isStarred: boolean;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'jsonb', default: [] })
  participantEmails: string[];

  @Column({ type: 'timestamp with time zone' })
  @Index()
  lastMessageAt: Date;

  @Column({ type: 'integer', default: 1 })
  messageCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 3: Create `EmailMessage` and `EmailAttachment` Entities**

Create `apps/api/src/modules/email/entities/email-message.entity.ts`:
```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { EmailThread } from './email-thread.entity';
import { EmailAttachment } from './email-attachment.entity';

export enum EmailDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum EmailMessageStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RECEIVED = 'RECEIVED',
}

@Entity('email_messages')
export class EmailMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column('uuid')
  @Index()
  threadId: string;

  @ManyToOne(() => EmailThread, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'threadId' })
  thread: EmailThread;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  messageIdHeader: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  inReplyToHeader: string | null;

  @Column({ type: 'jsonb', default: [] })
  referencesHeaders: string[];

  @Column({ type: 'enum', enum: EmailDirection })
  direction: EmailDirection;

  @Column({ type: 'varchar', length: 255 })
  fromEmail: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fromName: string | null;

  @Column({ type: 'jsonb', default: [] })
  toEmails: Array<{ name?: string; email: string }>;

  @Column({ type: 'jsonb', default: [] })
  ccEmails: Array<{ name?: string; email: string }>;

  @Column({ type: 'jsonb', default: [] })
  bccEmails: Array<{ name?: string; email: string }>;

  @Column({ type: 'varchar', length: 500 })
  subject: string;

  @Column({ type: 'text', default: '' })
  bodyHtml: string;

  @Column({ type: 'text', default: '' })
  bodyText: string;

  @Column({ type: 'boolean', default: false })
  hasAttachments: boolean;

  @Column({ type: 'enum', enum: EmailMessageStatus, default: EmailMessageStatus.RECEIVED })
  status: EmailMessageStatus;

  @OneToMany(() => EmailAttachment, (attachment) => attachment.emailMessage)
  attachments: EmailAttachment[];

  @CreateDateColumn()
  @Index()
  createdAt: Date;
}
```

Create `apps/api/src/modules/email/entities/email-attachment.entity.ts`:
```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { EmailMessage } from './email-message.entity';

@Entity('email_attachments')
export class EmailAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  emailMessageId: string;

  @ManyToOne(() => EmailMessage, (message) => message.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'emailMessageId' })
  emailMessage: EmailMessage;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'integer' })
  sizeBytes: number;

  @Column({ type: 'varchar', length: 500 })
  storageUrl: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 4: Create Entity Index File**

Create `apps/api/src/modules/email/entities/index.ts`:
```typescript
export * from './email-account.entity';
export * from './email-thread.entity';
export * from './email-message.entity';
export * from './email-attachment.entity';
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/email/entities
git commit -m "feat(api): add email client typeorm entities"
```

---

### Task 3: Backend Email Service & Threading Engine

**Files:**
- Create: `apps/api/src/modules/email/email.service.ts`
- Create: `apps/api/src/modules/email/email.service.spec.ts`

**Interfaces:**
- Produces: `EmailService.listThreads()`, `EmailService.getThread()`, `EmailService.sendEmail()`, `EmailService.ingestInboundEmail()`, `EmailService.saveDraft()`

- [ ] **Step 1: Write Unit Test for Email Threading & Service**

Create `apps/api/src/modules/email/email.service.spec.ts` testing thread resolution by header (`In-Reply-To`), fallback subject matching, contact auto-association, and sending messages.

- [ ] **Step 2: Implement `EmailService`**

Create `apps/api/src/modules/email/email.service.ts`:
Implement methods:
- `listAccounts(orgId, userId)`
- `createAccount(orgId, userId, dto)`
- `listThreads(orgId, filter)`
- `getThreadDetails(orgId, threadId)`
- `updateThread(orgId, threadId, patch)`
- `ingestInboundEmail(payload)`
- `sendEmail(orgId, userId, dto)`
- `saveDraft(orgId, userId, dto)`

- [ ] **Step 3: Run Unit Tests**

Run: `pnpm --filter @saas/api test apps/api/src/modules/email/email.service.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.service.spec.ts
git commit -m "feat(api): implement EmailService with RFC822 threading engine"
```

---

### Task 4: Backend Email Controllers & NestJS Module

**Files:**
- Create: `apps/api/src/modules/email/email.controller.ts`
- Create: `apps/api/src/modules/email/email-webhook.controller.ts`
- Create: `apps/api/src/modules/email/email.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: REST Endpoints `/api/v1/email/*`

- [ ] **Step 1: Implement `EmailController` & Webhook Controller**

Protect all endpoints using `@RequirePermissions()` decorator with `PERMISSIONS.EMAIL_*`.

- [ ] **Step 2: Wire `EmailModule` into `AppModule`**

Import `EmailModule` in `apps/api/src/app.module.ts`.

- [ ] **Step 3: Run API Build Verification**

Run: `pnpm --filter @saas/api build`
Expected: Clean build without TypeScript or NestJS wiring errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/email apps/api/src/app.module.ts
git commit -m "feat(api): add EmailController endpoints and wire EmailModule"
```

---

### Task 5: Web App Email API Client & UI Hooks

**Files:**
- Create: `apps/web/src/lib/api/email.ts`
- Create: `apps/web/src/hooks/use-email.ts`

- [ ] **Step 1: Create Email API Client**

Define type-safe frontend fetchers for email threads, accounts, messages, send, draft, and folder updates.

- [ ] **Step 2: Create React Custom Hooks**

`useEmailThreads`, `useEmailThreadDetails`, `useEmailAccounts` using React Query / SWR or custom state fetcher.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/email.ts apps/web/src/hooks/use-email.ts
git commit -m "feat(web): add email client API client and hooks"
```

---

### Task 6: Frontend Standalone Email Workspace (`/email`)

**Files:**
- Create: `apps/web/src/app/(app)/email/page.tsx`
- Create: `apps/web/src/components/email/email-workspace.tsx`
- Create: `apps/web/src/components/email/email-folder-sidebar.tsx`
- Create: `apps/web/src/components/email/email-thread-list.tsx`
- Create: `apps/web/src/components/email/email-reading-pane.tsx`
- Create: `apps/web/src/components/email/email-composer-modal.tsx`

- [ ] **Step 1: Create 3-Pane Email UI Components**

Implement responsive, high-aesthetic dark-mode compatible 3-pane email workspace:
- Folder Sidebar (Inbox, Starred, Sent, Drafts, Archive, Trash)
- Thread List with search, filter, and batch actions
- Reading Pane with iframe HTML sanitizer and inline reply composer
- Rich Text Composer Modal

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(app\)/email apps/web/src/components/email
git commit -m "feat(web): build 3-pane email workspace interface at /email"
```

---

### Task 7: Multi-Channel `/inbox` Email Thread Integration

**Files:**
- Modify: `apps/web/src/components/inbox/inbox-workspace.tsx`
- Modify: `apps/web/src/components/inbox/inbox-chat-panel.tsx`

- [ ] **Step 1: Add Email Channel Filter & Message Card Renderer**

Update `/inbox` workspace to display email conversation threads and render rich email cards (Subject, Header pills, HTML content viewer) alongside WhatsApp & Telegram messages.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/inbox
git commit -m "feat(web): integrate rich email view into multi-channel /inbox"
```

---

### Task 8: Verification & E2E Testing

- [ ] **Step 1: Verify NestJS API Compilation & Build**
Run: `pnpm --filter @saas/api build`

- [ ] **Step 2: Verify Web App Compilation & Build**
Run: `pnpm --filter @saas/web build`

- [ ] **Step 3: Commit Final Verification**
```bash
git commit --allow-empty -m "chore: verify email client build and integration"
```
