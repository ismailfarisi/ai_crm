import {
  Gauge,
  MessageCircle,
  Bell,
  Boxes,
  ClipboardList,
  CreditCard,
  Database,
  History,
  Factory,
  Building2,
  Calculator,
  FileText,
  FileUp,
  Landmark,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  MessageSquare,
  Package,
  PackageCheck,
  Radio,
  Receipt,
  ReceiptText,
  ShieldCheck,
  Store,
  UserRoundCog,
  Users,
  Wallet,
  Wrench,
  Zap,
} from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import type { AccessRule } from '@/lib/access';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * Hidden entirely when the rule fails. Keep this identical to the `PageGuard`
   * rule on the destination page — same rule shape, same evaluator, so a link
   * can never lead somewhere the user is then refused.
   */
  rule?: AccessRule;
  /** Renders a live count next to the label. */
  badge?: 'automationApprovals';
  /** One plain sentence on what the page is for: the tooltip, and what search matches besides the label. */
  hint?: string;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/** Every item, in menu order, with the group it sits in. */
export function allNavItems(): (NavItem & { group: string })[] {
  return [
    ...NAV_SECTIONS.flatMap((s) => s.items.map((item) => ({ ...item, group: s.title ?? '' }))),
    ...SETTINGS_SECTIONS.flatMap((s) =>
      s.items.map((item) => ({ ...item, group: `Settings · ${s.title ?? ''}` })),
    ),
  ];
}

/**
 * Menu search: every word typed must appear in the label, the hint or the
 * group name, so "bill" finds Supplier bills and Billing, and "whatsapp"
 * finds the Inbox. Label matches sort first.
 */
export function searchNav<T extends NavItem & { group: string }>(items: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hay = (item: T) => `${item.label} ${item.hint ?? ''} ${item.group}`.toLowerCase();
  const inLabel = (item: T) => words.every((w) => item.label.toLowerCase().includes(w));
  return items
    .filter((item) => words.every((w) => hay(item).includes(w)))
    .sort((a, b) => Number(inLabel(b)) - Number(inLabel(a)));
}

/**
 * The navigation registry, kept out of `app-shell.tsx` so that adding a
 * section is a data change in a small file rather than an edit inside a
 * component every feature branch is also editing.
 *
 * Grouped by the job a shop is doing: selling, making, buying, money, people,
 * messages, and the helpers that work on your behalf.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'What needs you today' }],
  },
  {
    title: 'Sell',
    items: [
      {
        href: '/quotes',
        label: 'Quotes',
        icon: FileText,
        rule: { permission: PERMISSIONS.QUOTE_READ },
        hint: 'Prices you send to customers for approval and acceptance',
      },
      {
        href: '/customers',
        label: 'Customers',
        icon: Building2,
        rule: { permission: PERMISSIONS.CUSTOMER_READ },
        hint: 'The companies you quote and invoice',
      },
      {
        href: '/contacts',
        label: 'Contacts',
        icon: Users,
        rule: { permission: PERMISSIONS.CONTACT_READ },
        hint: 'People you talk to: leads, buyers and chat senders',
      },
      {
        href: '/catalog',
        label: 'Catalog',
        icon: Package,
        rule: { permission: PERMISSIONS.CATALOG_MANAGE },
        hint: 'Products, materials and prices you quote from',
      },
    ],
  },
  {
    title: 'Make',
    items: [
      {
        href: '/orders',
        label: 'Sales orders',
        icon: PackageCheck,
        rule: { permission: PERMISSIONS.SALES_ORDER_READ },
        hint: 'Accepted jobs, from deposit to delivery and final invoice',
      },
      {
        href: '/production',
        label: 'Production',
        icon: Wrench,
        rule: { permission: PERMISSIONS.WORK_ORDER_READ },
        hint: 'Work orders on the shop floor',
      },
      {
        href: '/inventory',
        label: 'Stock',
        icon: Boxes,
        rule: { permission: PERMISSIONS.INVENTORY_READ },
        hint: 'Materials on hand, inventory and stock counts',
      },
    ],
  },
  {
    title: 'Buy',
    items: [
      {
        href: '/purchasing/suppliers',
        label: 'Suppliers',
        icon: Factory,
        rule: { permission: PERMISSIONS.SUPPLIER_READ },
        hint: 'The companies you buy from',
      },
      {
        href: '/purchasing/orders',
        label: 'Purchase orders',
        icon: ClipboardList,
        rule: { permission: PERMISSIONS.PURCHASE_ORDER_READ },
        hint: 'What you have ordered from suppliers',
      },
      {
        href: '/purchasing/bills',
        label: 'Supplier bills',
        icon: ReceiptText,
        rule: { permission: PERMISSIONS.BILL_READ },
        hint: 'Bills to pay to suppliers',
      },
    ],
  },
  {
    title: 'Money',
    items: [
      {
        href: '/invoices',
        label: 'Invoices',
        icon: Receipt,
        rule: { permission: PERMISSIONS.INVOICE_READ },
        hint: 'What customers owe you, and payments received',
      },
      {
        href: '/finance',
        label: 'Finance',
        icon: Landmark,
        rule: { permission: PERMISSIONS.FINANCE_READ },
        hint: 'Bank, books, VAT and reports',
      },
    ],
  },
  {
    title: 'People',
    items: [
      {
        href: '/people',
        label: 'People',
        icon: Users,
        rule: { anyOf: [PERMISSIONS.EMPLOYEE_READ, PERMISSIONS.TIMESHEET_READ] },
        hint: 'Staff, timesheets and payroll',
      },
    ],
  },
  {
    title: 'Messages',
    items: [
      {
        href: '/inbox',
        label: 'Inbox',
        icon: MessageSquare,
        rule: { permission: PERMISSIONS.CHANNEL_READ },
        hint: 'Customer chats on WhatsApp, Telegram and your other channels',
      },
      {
        href: '/email',
        label: 'Email',
        icon: Mail,
        rule: { permission: PERMISSIONS.EMAIL_READ },
        hint: 'Your connected mailboxes: read and send email',
      },
    ],
  },
  {
    title: 'Helpers',
    items: [
      {
        href: '/assistant',
        label: 'Assistant',
        icon: MessageCircle,
        rule: { permission: PERMISSIONS.ASSISTANT_USE },
        hint: 'Ask the AI to look things up or draft work for you; customers never see it',
      },
      {
        href: '/automations',
        label: 'Automations',
        icon: Zap,
        rule: { permission: PERMISSIONS.AUTOMATION_READ },
        hint: 'Steps that run on their own when something happens',
      },
      {
        href: '/automations/approvals',
        label: 'Approvals',
        icon: ShieldCheck,
        rule: { permission: PERMISSIONS.AUTOMATION_APPROVE },
        badge: 'automationApprovals',
        hint: 'Automation and AI actions waiting for your yes',
      },
    ],
  },
];

/** Settings, in four small groups under one "Settings" heading. */
export const SETTINGS_SECTIONS: NavSection[] = [
  {
    title: 'Your business',
    items: [
      {
        href: '/settings/company',
        label: 'Company',
        icon: Building2,
        rule: { permission: PERMISSIONS.ORG_READ },
        hint: 'Name, address, tax number and logo',
      },
      {
        href: '/settings/costing',
        label: 'Costing rules',
        icon: Calculator,
        rule: { permission: PERMISSIONS.CATALOG_READ },
        hint: 'Margin floor, discount cap and over-budget warning',
      },
      {
        href: '/settings/branches',
        label: 'Branches',
        icon: Store,
        rule: { permission: PERMISSIONS.ORG_READ },
      },
      {
        href: '/settings/document-templates',
        label: 'Document templates',
        icon: LayoutTemplate,
        rule: { permission: PERMISSIONS.DOCUMENT_TEMPLATE_READ },
        hint: 'How quotes and invoices look',
      },
      {
        href: '/settings/payments',
        label: 'Online payments',
        icon: Wallet,
        rule: { permission: PERMISSIONS.ORG_MANAGE_PAYMENTS },
        hint: 'Card payments and default deposit',
      },
      {
        href: '/settings/billing',
        label: 'Billing',
        icon: CreditCard,
        rule: { permission: PERMISSIONS.ORG_MANAGE_BILLING },
        hint: 'Your Kerf plan',
      },
      {
        href: '/settings/import',
        label: 'Import data',
        icon: FileUp,
        rule: {
          anyOf: [
            PERMISSIONS.CUSTOMER_CREATE,
            PERMISSIONS.CONTACT_CREATE,
            PERMISSIONS.CATALOG_MANAGE,
            PERMISSIONS.INVENTORY_ADJUST,
          ],
        },
        hint: 'Bring in customers, contacts, catalog or stock from a spreadsheet',
      },
    ],
  },
  {
    title: 'Team and access',
    items: [
      {
        href: '/settings/team',
        label: 'Team',
        icon: Users,
        rule: { permission: PERMISSIONS.USER_READ },
        hint: 'Who can sign in; invite staff',
      },
      {
        href: '/settings/teams',
        label: 'Teams',
        icon: UserRoundCog,
        rule: { permission: PERMISSIONS.USER_READ },
      },
      {
        href: '/settings/roles',
        label: 'Roles & permissions',
        icon: ShieldCheck,
        rule: { permission: PERMISSIONS.ROLE_READ },
      },
      {
        href: '/settings/audit',
        label: 'Audit trail',
        icon: History,
        rule: { permission: PERMISSIONS.AUDIT_READ },
        hint: 'Who changed what, and when',
      },
    ],
  },
  {
    title: 'Messages and alerts',
    items: [
      {
        href: '/settings/channels',
        label: 'Channels',
        icon: Radio,
        rule: { permission: PERMISSIONS.CHANNEL_MANAGE },
        hint: 'Connect WhatsApp, Telegram and website chat to the Inbox',
      },
      {
        href: '/settings/email',
        label: 'Email accounts',
        icon: Mail,
        rule: { permission: PERMISSIONS.EMAIL_READ },
        hint: 'Connect a mailbox to Email',
      },
      {
        href: '/settings/notifications',
        label: 'Notifications',
        icon: Bell,
      },
    ],
  },
  {
    title: 'Advanced',
    items: [
      {
        href: '/settings/ai',
        label: 'AI',
        icon: Gauge,
        rule: { permission: PERMISSIONS.AI_MANAGE },
        hint: 'AI provider and the agents that answer customers',
      },
      {
        href: '/settings/objects',
        label: 'Object Studio',
        icon: Database,
        rule: { permission: PERMISSIONS.CUSTOM_OBJECT_MANAGE },
        hint: 'Your own record types',
      },
    ],
  },
];
