import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PERMISSIONS,
  type ApproveProofPayload,
  type DeclineQuotePayload,
  type NotificationType,
  type PublicQuoteDto,
  type RequestProofChangesPayload,
  type RequestQuoteChangesPayload,
} from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QuoteProof } from './entities/quote-proof.entity';
import { Quote } from './entities/quote.entity';
import {
  escapeHtml,
  hashToken,
  QuoteAcceptanceService,
} from './quote-acceptance.service';
import { QuoteProofsService } from './quote-proofs.service';

interface StaffAlert {
  type: NotificationType;
  /** What the notification is about, so a repeat replaces it rather than stacking. */
  entityId: string;
  title: string;
  /** The customer's own words, untrusted. Escaped before it reaches HTML. */
  note: string | null;
  noteLabel: string;
}

/**
 * What a customer can say on the quote link besides "yes": decline it, ask
 * for changes, and approve or send back an artwork proof.
 *
 * Each response is checked against the token exactly as an acceptance is,
 * recorded on the quote, written to the audit trail by hand (there is no
 * signed-in user for the interceptor to attribute it to), and passed to the
 * people who can act on it by bell and by email.
 */
@Injectable()
export class QuoteResponsesService {
  private readonly logger = new Logger(QuoteResponsesService.name);

  constructor(
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    @InjectRepository(QuoteProof)
    private readonly proofRows: Repository<QuoteProof>,
    private readonly acceptance: QuoteAcceptanceService,
    private readonly proofs: QuoteProofsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  decline(
    token: string,
    input: DeclineQuotePayload,
    ip: string | undefined,
  ): Promise<PublicQuoteDto> {
    return this.respond(token, ip, {
      kind: 'DECLINED',
      name: input.name,
      note: input.reason,
    });
  }

  requestChanges(
    token: string,
    input: RequestQuoteChangesPayload,
    ip: string | undefined,
  ): Promise<PublicQuoteDto> {
    return this.respond(token, ip, {
      kind: 'CHANGES_REQUESTED',
      name: input.name,
      note: input.note,
    });
  }

  approveProof(
    token: string,
    proofId: string,
    input: ApproveProofPayload,
    ip: string | undefined,
  ): Promise<PublicQuoteDto> {
    return this.answerProof(token, proofId, ip, {
      status: 'APPROVED',
      name: input.name,
      comment: null,
    });
  }

  requestProofChanges(
    token: string,
    proofId: string,
    input: RequestProofChangesPayload,
    ip: string | undefined,
  ): Promise<PublicQuoteDto> {
    return this.answerProof(token, proofId, ip, {
      status: 'CHANGES_REQUESTED',
      name: input.name,
      comment: input.comment,
    });
  }

  private respond(
    token: string,
    ip: string | undefined,
    response: {
      kind: 'DECLINED' | 'CHANGES_REQUESTED';
      name: string;
      note: string | null;
    },
  ): Promise<PublicQuoteDto> {
    return this.acceptance.withQuoteFor(token, async (found) => {
      const refusal = this.acceptance.refusalFor(found, {
        allowAccepted: false,
      });
      if (refusal) this.acceptance.refuse(refusal);
      const quote = found!;

      // Conditional on the same things acceptance is, so a response cannot
      // land on a quote that was accepted, replaced or re-sent meanwhile.
      const respondedAt = new Date();
      const result = await this.quotes
        .createQueryBuilder()
        .update(Quote)
        .set({
          customerResponse: response.kind,
          customerResponseNote: response.note,
          customerRespondedAt: respondedAt,
          customerRespondedByName: response.name,
        })
        .where('id = :id', { id: quote.id })
        .andWhere('accepted_at IS NULL')
        .andWhere('superseded_at IS NULL')
        .andWhere('acceptance_token_hash = :hash', { hash: hashToken(token) })
        .andWhere("customer_response IS DISTINCT FROM 'DECLINED'")
        .execute();
      if (!result.affected) this.acceptance.refuse('NO_LONGER_AVAILABLE');

      const before = {
        customerResponse: quote.customerResponse,
        customerResponseNote: quote.customerResponseNote,
      };
      quote.customerResponse = response.kind;
      quote.customerResponseNote = response.note;
      quote.customerRespondedAt = respondedAt;
      quote.customerRespondedByName = response.name;

      const reference = quote.quoteNumber ?? 'A quote';
      const declined = response.kind === 'DECLINED';
      await this.audit.record({
        tenantId: quote.tenantId,
        action: declined
          ? 'quote.customer_decline'
          : 'quote.customer_request_changes',
        subjectType: 'QUOTE',
        subjectId: quote.id,
        actorName: `${response.name} (customer)`,
        summary: reference,
        before,
        after: {
          customerResponse: response.kind,
          customerResponseNote: response.note,
        },
        ip: ip?.slice(0, 64) ?? null,
        channel: 'WEB',
      });
      await this.alertStaff(quote, response.name, {
        type: 'QUOTE_CUSTOMER_RESPONSE',
        entityId: quote.id,
        title: declined
          ? `${reference} was declined by ${quote.customerName}`
          : `${quote.customerName} asked for changes to ${reference}`,
        note: response.note,
        noteLabel: declined ? 'Reason' : 'Requested changes',
      });
      return this.acceptance.toPublic(quote);
    });
  }

  private answerProof(
    token: string,
    proofId: string,
    ip: string | undefined,
    answer: {
      status: 'APPROVED' | 'CHANGES_REQUESTED';
      name: string;
      comment: string | null;
    },
  ): Promise<PublicQuoteDto> {
    return this.acceptance.withQuoteFor(token, async (found) => {
      // Artwork is often signed off after the order is placed, so an
      // accepted quote still takes proof answers. Everything else that
      // stops an acceptance stops these too.
      const refusal = this.acceptance.refusalFor(found, {
        allowAccepted: true,
      });
      if (refusal) this.acceptance.refuse(refusal);
      const quote = found!;

      const latest = await this.proofs.latestFor(quote.tenantId, quote.id);
      if (!latest || latest.id !== proofId) {
        throw new BadRequestException(
          'This proof has been replaced by a newer version. Refresh the page to see it.',
        );
      }
      if (latest.status !== 'PENDING') {
        throw new BadRequestException('This proof has already been answered.');
      }

      const respondedAt = new Date();
      const result = await this.proofRows
        .createQueryBuilder()
        .update(QuoteProof)
        .set({
          status: answer.status,
          respondedAt,
          respondedByName: answer.name,
          responseComment: answer.comment,
          respondedIp: ip?.slice(0, 64) ?? null,
        })
        .where('id = :id', { id: latest.id })
        .andWhere('quote_id = :quoteId', { quoteId: quote.id })
        .andWhere("status = 'PENDING'")
        .andWhere('superseded_at IS NULL')
        .execute();
      if (!result.affected) {
        throw new BadRequestException('This proof has already been answered.');
      }

      const approved = answer.status === 'APPROVED';
      const reference = quote.quoteNumber ?? 'a quote';
      await this.audit.record({
        tenantId: quote.tenantId,
        action: approved
          ? 'quote.proof_approve'
          : 'quote.proof_request_changes',
        subjectType: 'QUOTE',
        subjectId: quote.id,
        actorName: `${answer.name} (customer)`,
        summary: `v${latest.version} of ${reference}`,
        before: { proofVersion: latest.version, proofStatus: 'PENDING' },
        after: {
          proofVersion: latest.version,
          proofStatus: answer.status,
          proofComment: answer.comment,
        },
        ip: ip?.slice(0, 64) ?? null,
        channel: 'WEB',
      });
      await this.alertStaff(quote, answer.name, {
        type: 'QUOTE_PROOF_RESPONSE',
        entityId: latest.id,
        title: approved
          ? `${quote.customerName} approved proof v${latest.version} for ${reference}`
          : `${quote.customerName} asked for changes to proof v${latest.version} for ${reference}`,
        note: answer.comment,
        noteLabel: 'Comment',
      });
      return this.acceptance.toPublic(quote);
    });
  }

  /**
   * The bell and an email for whoever can act: holders of quote approve or
   * update, and the person who created the quote. Never fails the response:
   * the customer has said their piece either way.
   */
  private async alertStaff(
    quote: Quote,
    customerName: string,
    alert: StaffAlert,
  ): Promise<void> {
    try {
      const recipients = await this.recipientsFor(quote);
      if (!recipients.length) return;
      const link = `/quotes/${quote.id}`;
      await this.notifications.notifyUsers(
        quote.tenantId,
        recipients.map((r) => r.id),
        {
          type: alert.type,
          title: alert.title,
          body: alert.note ? alert.note.slice(0, 500) : null,
          link,
          entityType: 'QUOTE',
          entityId: alert.entityId,
        },
      );

      const url = `${this.config.get('publicWebUrl', { infer: true })}${link}`;
      const html = [
        `<p>${escapeHtml(alert.title)}.</p>`,
        `<p>Responded as: ${escapeHtml(customerName)}</p>`,
        alert.note
          ? `<p><strong>${escapeHtml(alert.noteLabel)}:</strong><br>${escapeHtml(alert.note).replace(/\n/g, '<br>')}</p>`
          : '',
        `<p><a href="${escapeHtml(url)}">Open the quote</a></p>`,
      ].join('');
      const text = [
        `${alert.title}.`,
        `Responded as: ${customerName}`,
        alert.note ? `${alert.noteLabel}:\n${alert.note}` : '',
        `Open the quote: ${url}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      for (const recipient of recipients) {
        if (!recipient.email) continue;
        try {
          await this.mail.sendMail({
            to: recipient.email,
            subject: alert.title.slice(0, 200),
            html,
            text,
          });
        } catch (err) {
          this.logger.warn(
            `Could not email ${recipient.email} about ${quote.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not alert staff about ${quote.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Active users holding quote approve or update, plus the quote's creator.
   *
   * A quote has no owner column; its creator is the first signed-in actor on
   * its audit trail (or on the quote it revises), which is who a salesperson
   * would call the owner.
   */
  private async recipientsFor(
    quote: Quote,
  ): Promise<{ id: string; email: string | null }[]> {
    return this.quotes.manager.query(
      `SELECT DISTINCT u."id", u."email"
       FROM "users" u
       WHERE u."tenant_id" = $1
         AND u."isActive"
         AND (
           u."id" IN (
             SELECT ur."userId"
             FROM "user_roles" ur
             JOIN "roles" r ON r."id" = ur."roleId"
             LEFT JOIN "role_permissions" rp ON rp."roleId" = r."id"
             LEFT JOIN "permissions" p ON p."id" = rp."permissionId"
             WHERE r."grantsAllPermissions" OR p."key" = ANY($2)
           )
           OR u."id" = (
             SELECT a."actor_id" FROM "audit_logs" a
             WHERE a."tenant_id" = $1
               AND a."subject_type" = 'QUOTE'
               AND a."subject_id" = ANY($3::uuid[])
               AND a."actor_id" IS NOT NULL
             ORDER BY a."created_at" ASC
             LIMIT 1
           )
         )`,
      [
        quote.tenantId,
        [PERMISSIONS.QUOTE_APPROVE, PERMISSIONS.QUOTE_UPDATE],
        [quote.id, quote.parentQuoteId].filter(Boolean),
      ],
    );
  }
}
