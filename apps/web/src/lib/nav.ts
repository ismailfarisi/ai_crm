import {
  Bot,
  ClipboardList,
  Factory,
  Building2,
  FileText,
  Landmark,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Receipt,
  ShieldCheck,
  UserRoundCog,
  Users,
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
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * The navigation registry, kept out of `app-shell.tsx` so that adding a
 * section is a data change in a small file rather than an edit inside a
 * component every feature branch is also editing.
 */
export const CORE_ACTION_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: MessageSquare,
    rule: { permission: PERMISSIONS.CHANNEL_READ },
  },
  {
    href: '/contacts',
    label: 'Contacts',
    icon: Users,
    rule: { permission: PERMISSIONS.CONTACT_READ },
  },
  {
    href: '/customers',
    label: 'Customers',
    icon: Building2,
    rule: { permission: PERMISSIONS.CUSTOMER_READ },
  },
  {
    href: '/quotes',
    label: 'Quotes',
    icon: FileText,
    rule: { permission: PERMISSIONS.QUOTE_READ },
  },
  {
    href: '/invoices',
    label: 'Invoices',
    icon: Receipt,
    rule: { permission: PERMISSIONS.INVOICE_READ },
  },
  {
    href: '/purchasing/orders',
    label: 'Purchase orders',
    icon: ClipboardList,
    rule: { permission: PERMISSIONS.PURCHASE_ORDER_READ },
  },
  {
    href: '/purchasing/suppliers',
    label: 'Suppliers',
    icon: Factory,
    rule: { permission: PERMISSIONS.SUPPLIER_READ },
  },
  {
    href: '/finance',
    label: 'Finance',
    icon: Landmark,
    rule: { permission: PERMISSIONS.FINANCE_READ },
  },
  {
    href: '/automations',
    label: 'Automations',
    icon: Zap,
    rule: { permission: PERMISSIONS.AUTOMATION_READ },
  },
];

export const SECONDARY_SECTIONS: NavSection[] = [
  {
    title: 'Settings',
    items: [
      {
        href: '/settings/team',
        label: 'Team',
        icon: Users,
        rule: { permission: PERMISSIONS.USER_READ },
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
        href: '/settings/channels',
        label: 'Channels',
        icon: Radio,
        rule: { permission: PERMISSIONS.CHANNEL_MANAGE },
      },
      {
        href: '/settings/ai',
        label: 'AI Cost Guard',
        icon: Bot,
        rule: { permission: PERMISSIONS.AI_MANAGE },
      },
    ],
  },
];
