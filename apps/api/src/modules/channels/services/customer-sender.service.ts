import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  CustomerSenderCheckDto,
  CustomerSenderLinkDto,
  LinkCustomerSenderPayload,
} from '@saas/shared';
import { Customer } from '../../customers/entities/customer.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import {
  canonicalSender,
  emailOnRecord,
  phoneOnRecord,
  senderKind,
} from '../agents/sender-identity';
import { CustomerChannelSender } from '../entities/customer-channel-sender.entity';

/** The one customer a sender has been tied to. */
export interface VerifiedSender {
  customerId: string;
  companyName: string;
  via: 'LINKED' | 'ON_RECORD';
}

const NOBODY: CustomerSenderCheckDto = {
  status: 'UNKNOWN',
  customer: null,
  linkId: null,
};

/**
 * Which customer a sender on a channel is.
 *
 * A sender counts as a customer in two ways only, both resting on something
 * staff entered and never on what the sender says about themselves:
 *
 *  1. staff linked this exact sender to the customer, or
 *  2. the sender's WhatsApp number, or email address, is the phone or email
 *     on exactly one customer's record.
 *
 * A number on two customers' records names neither. The channel's own word
 * for who sent a message is trusted because the reply goes back to that same
 * number or address and nowhere else, so claiming to be someone gets the
 * answer delivered to them, not to the claimant.
 */
@Injectable()
export class CustomerSenderService {
  constructor(
    @InjectRepository(CustomerChannelSender)
    private readonly links: Repository<CustomerChannelSender>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  /** The customer an agent may answer this sender as, or null. */
  async resolve(
    organizationId: string,
    provider: string,
    senderIdentifier: string,
  ): Promise<VerifiedSender | null> {
    const check = await this.check(organizationId, provider, senderIdentifier);
    if (!check.customer) return null;
    if (check.status !== 'LINKED' && check.status !== 'ON_RECORD') return null;
    return {
      customerId: check.customer.id,
      companyName: check.customer.companyName,
      via: check.status,
    };
  }

  async check(
    organizationId: string,
    provider: string,
    senderIdentifier: string,
  ): Promise<CustomerSenderCheckDto> {
    const identifier = canonicalSender(provider, senderIdentifier);
    if (!identifier) return { ...NOBODY, status: 'UNSUPPORTED' };

    const link = await this.links.findOne({
      where: { organizationId, provider, identifier },
    });
    if (link) {
      // A deleted customer's link names nobody; it does not fall through to
      // the records, which would quietly re-point the sender at someone else.
      const customer = await this.customers.findOne({
        where: { id: link.customerId, tenantId: organizationId },
      });
      return customer
        ? {
            status: 'LINKED',
            customer: { id: customer.id, companyName: customer.companyName },
            linkId: link.id,
          }
        : { ...NOBODY, linkId: link.id };
    }

    const matches = await this.onRecord(organizationId, provider, identifier);
    if (matches.length === 0) return NOBODY;
    if (matches.length > 1) return { ...NOBODY, status: 'AMBIGUOUS' };
    return {
      status: 'ON_RECORD',
      customer: { id: matches[0].id, companyName: matches[0].companyName },
      linkId: null,
    };
  }

  /** Customers whose own record carries this number or address. */
  private async onRecord(
    organizationId: string,
    provider: string,
    identifier: string,
  ): Promise<Customer[]> {
    const kind = senderKind(provider);
    if (kind === 'email') {
      const candidates = await this.customers
        .createQueryBuilder('customer')
        .where('customer.tenantId = :organizationId', { organizationId })
        .andWhere('LOWER(TRIM(customer.email)) = :identifier', { identifier })
        .getMany();
      return candidates.filter((c) => emailOnRecord(c.email) === identifier);
    }
    if (kind !== 'phone') return [];

    // Narrowed in SQL by the last digits, decided in code: how a number was
    // typed ("+971 50…", "050…") is read against the customer's country.
    const candidates = await this.customers
      .createQueryBuilder('customer')
      .where('customer.tenantId = :organizationId', { organizationId })
      .andWhere(`regexp_replace(customer.phone, '\\D', '', 'g') LIKE :tail`, {
        tail: `%${identifier.slice(-7)}`,
      })
      .getMany();
    if (candidates.length === 0) return [];
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
      select: { id: true, country: true },
    });
    return candidates.filter(
      (c) =>
        phoneOnRecord(c.phone, c.country ?? organization?.country ?? null) ===
        identifier,
    );
  }

  /** A customer picked by staff, for trying a message as them. Never a real sender. */
  async asCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<VerifiedSender> {
    const customer = await this.customers.findOne({
      where: { id: customerId, tenantId: organizationId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return {
      customerId: customer.id,
      companyName: customer.companyName,
      via: 'LINKED',
    };
  }

  async link(
    organizationId: string,
    userId: string,
    payload: LinkCustomerSenderPayload,
  ): Promise<CustomerChannelSender> {
    const identifier = canonicalSender(payload.provider, payload.identifier);
    if (!identifier) {
      throw new BadRequestException(
        'This sender cannot be linked to a customer. It has to be one phone number, one email address or one private chat.',
      );
    }
    const customer = await this.customers.findOne({
      where: { id: payload.customerId, tenantId: organizationId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const where = { organizationId, provider: payload.provider, identifier };
    const existing = await this.links.findOne({ where });
    // One sender, one customer: linking again moves it.
    return this.links.save(
      this.links.create({
        ...(existing ?? where),
        customerId: customer.id,
        createdById: userId,
      }),
    );
  }

  async unlink(organizationId: string, id: string): Promise<void> {
    const link = await this.links.findOne({ where: { organizationId, id } });
    if (!link) throw new NotFoundException('Link not found');
    await this.links.remove(link);
  }

  listForCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<CustomerChannelSender[]> {
    return this.links.find({
      where: { organizationId, customerId },
      order: { createdAt: 'ASC' },
    });
  }

  toDto(link: CustomerChannelSender): CustomerSenderLinkDto {
    return {
      id: link.id,
      customerId: link.customerId,
      provider: link.provider,
      identifier: link.identifier,
      createdAt: link.createdAt.toISOString(),
    };
  }
}
