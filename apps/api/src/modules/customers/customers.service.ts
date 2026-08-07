import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, type SelectQueryBuilder } from 'typeorm';
import {
  type CreateCustomerInput,
  type CustomerDto,
  type PaginatedResult,
  type UpdateCustomerInput,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { Customer } from './entities/customer.entity';
import type { CustomerQueryDto } from './dto/customer-query.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: CustomerQueryDto,
  ): Promise<PaginatedResult<CustomerDto>> {
    const qb = this.scoped(actor);

    if (query.search) {
      const term = `%${query.search.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('LOWER(customer.companyName) LIKE :term', { term })
            .orWhere('LOWER(customer.contactName) LIKE :term', { term })
            .orWhere('LOWER(customer.email) LIKE :term', { term })
            .orWhere('LOWER(customer.city) LIKE :term', { term });
        }),
      );
    }

    const [items, total] = await qb
      .orderBy(`customer.${query.sortBy}`, query.sortOrder)
      .addOrderBy('customer.id', 'ASC') // stable paging when sort keys tie
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const totalPages = Math.max(1, Math.ceil(total / query.limit));

    return {
      items: items.map((customer) => this.toDto(customer)),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<CustomerDto> {
    return this.toDto(await this.findEntity(actor, id));
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateCustomerInput,
  ): Promise<CustomerDto> {
    const customer = this.customers.create({
      ...(input as object),
      organizationId: actor.organizationId,
    } as Partial<Customer>);

    const saved = await this.customers.save(customer);
    return this.findOne(actor, saved.id);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerDto> {
    const customer = await this.findEntity(actor, id);
    Object.assign(customer, input);
    await this.customers.save(customer);
    return this.findOne(actor, customer.id);
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    const customer = await this.findEntity(actor, id);
    await this.customers.softRemove(customer);
  }

  /** Every query starts here: customers are org-wide, so the tenant filter is all. */
  private scoped(actor: AuthenticatedUser): SelectQueryBuilder<Customer> {
    return this.customers
      .createQueryBuilder('customer')
      .where('customer.organizationId = :organizationId', {
        organizationId: actor.organizationId,
      });
  }

  private async findEntity(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<Customer> {
    const customer = await this.scoped(actor)
      .andWhere('customer.id = :id', { id })
      .getOne();

    if (!customer) {
      // Same 404 whether it doesn't exist or belongs to another org.
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private toDto(customer: Customer): CustomerDto {
    return {
      id: customer.id,
      companyName: customer.companyName,
      contactName: customer.contactName,
      email: customer.email,
      phone: customer.phone,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      city: customer.city,
      postalCode: customer.postalCode,
      country: customer.country,
      taxId: customer.taxId,
      currency: customer.currency,
      paymentTermsDays: customer.paymentTermsDays,
      notes: customer.notes,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }
}
