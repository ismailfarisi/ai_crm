import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Invitation } from '@/modules/invitations/entities/invitation.entity';
import { Role } from '@/modules/rbac/entities/role.entity';
import { Team } from '@/modules/teams/entities/team.entity';
import { User } from '@/modules/users/entities/user.entity';

/** The tenant boundary. Every other row in the CRM hangs off one of these. */
@Entity('organizations')
export class Organization extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index('uq_organizations_slug', { unique: true })
  @Column({ type: 'varchar', length: 140 })
  slug: string;

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => Role, (role) => role.organization)
  roles: Role[];

  @OneToMany(() => Contact, (contact) => contact.organization)
  contacts: Contact[];

  @OneToMany(() => Team, (team) => team.organization)
  teams: Team[];

  @OneToMany(() => Customer, (customer) => customer.organization)
  customers: Customer[];

  @OneToMany(() => Invitation, (invitation) => invitation.organization)
  invitations: Invitation[];

  /** The currency the ledger is kept in. Every posting is converted to it. */
  @Column({ name: 'base_currency', type: 'char', length: 3, default: 'USD' })
  baseCurrency: string;

  /* ---------------------------------------------------------------- *
   * Who the company is on paper
   *
   * Everything below prints on the documents customers receive. Until it
   * existed a quote went out headed by nothing but `name`, with no address
   * and no tax registration — which most jurisdictions require on an invoice,
   * and which no screen could supply.
   * ---------------------------------------------------------------- */

  /** The registered name, when it differs from the one used day to day. */
  @Column({ name: 'legal_name', type: 'varchar', length: 200, nullable: true })
  legalName: string | null;

  /** VAT or sales tax registration, printed on every tax document. */
  @Column({ name: 'tax_id', type: 'varchar', length: 60, nullable: true })
  taxId: string | null;

  /** Companies-house or equivalent number. */
  @Column({
    name: 'registration_number',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  registrationNumber: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  website: string | null;

  @Column({ name: 'address_line1', type: 'varchar', length: 200, nullable: true })
  addressLine1: string | null;

  @Column({ name: 'address_line2', type: 'varchar', length: 200, nullable: true })
  addressLine2: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  /** State, province or county. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  region: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 30, nullable: true })
  postalCode: string | null;

  /** ISO 3166-1 alpha-2, so tax rules can match on it. */
  @Column({ type: 'char', length: 2, nullable: true })
  country: string | null;

  /** Printed under the totals: payment instructions, bank details, terms. */
  @Column({ name: 'document_footer', type: 'text', nullable: true })
  documentFooter: string | null;

  /**
   * The logo printed on documents, as stored bytes.
   *
   * Held on the row rather than in the attachment store because it is the one
   * file served *inline*, to anyone holding a quote link, with no session to
   * check — so it needs a route of its own rather than a signed, expiring
   * download. Raster only and capped at 2 MB (`LOGO_CONTENT_TYPES`,
   * `LOGO_MAX_BYTES`): an inline SVG is a script on the origin serving it.
   */
  @Column({ name: 'logo_data', type: 'bytea', nullable: true })
  logoData: Buffer | null;

  @Column({ name: 'logo_content_type', type: 'varchar', length: 40, nullable: true })
  logoContentType: string | null;

  /** Cache-busts the public logo URL when the logo is replaced. */
  @Column({ name: 'logo_updated_at', type: 'timestamptz', nullable: true })
  logoUpdatedAt: Date | null;
}
