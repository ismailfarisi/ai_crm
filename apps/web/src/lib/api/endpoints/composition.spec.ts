import { describe, it, expect } from 'vitest';
import { api, queryKeys } from './index';
import { authEndpoints, authKeys } from './auth';
import { contactsEndpoints, contactsKeys } from './contacts';
import { customersEndpoints, customersKeys } from './customers';
import { rbacEndpoints, rbacKeys } from './rbac';
import { salesEndpoints, salesKeys } from './sales';
import { channelsEndpoints, channelsKeys } from './channels';
import { automationsEndpoints, automationsKeys } from './automations';
import { financeEndpoints, financeKeys } from './finance';
import { aiEndpoints, aiKeys } from './ai';
import { purchasingEndpoints, purchasingKeys } from './purchasing';
import { inventoryEndpoints, inventoryKeys } from './inventory';
import { payablesEndpoints, payablesKeys } from './payables';
import { ordersEndpoints, ordersKeys } from './orders';
import { productionEndpoints, productionKeys } from './production';

/**
 * Guards for the composed API surface.
 *
 * `api` and `queryKeys` are spread together from one file per feature area.
 * That removes the merge conflicts a single 477-line module caused, and adds
 * one failure mode in exchange: two slices claiming the same top-level name
 * would silently overwrite each other, and the losing endpoints would simply
 * stop existing. The counts below are the surface as it stood before the
 * split — update them deliberately, never to make a red test green.
 */

const SLICES = [
  ['auth', authEndpoints, authKeys],
  ['contacts', contactsEndpoints, contactsKeys],
  ['customers', customersEndpoints, customersKeys],
  ['rbac', rbacEndpoints, rbacKeys],
  ['sales', salesEndpoints, salesKeys],
  ['channels', channelsEndpoints, channelsKeys],
  ['automations', automationsEndpoints, automationsKeys],
  ['finance', financeEndpoints, financeKeys],
  ['ai', aiEndpoints, aiKeys],
  ['purchasing', purchasingEndpoints, purchasingKeys],
  ['inventory', inventoryEndpoints, inventoryKeys],
  ['payables', payablesEndpoints, payablesKeys],
  ['orders', ordersEndpoints, ordersKeys],
  ['production', productionEndpoints, productionKeys],
] as const;

const API_SECTIONS = [
  'auth', 'contacts', 'customers', 'roles', 'users', 'invitations', 'teams',
  'quotes', 'catalog', 'invoices', 'channels', 'aiAgents', 'intentAgentConfig',
  'automations', 'finance', 'expenses', 'ai', 'suppliers',
  'purchaseOrders', 'purchasePolicy', 'inventory', 'goodsReceipts', 'bills',
  'salesOrders', 'quoteAcceptance', 'workOrders',
];

const QUERY_KEYS = [
  'session', 'contacts', 'contact', 'contactStats', 'customers', 'customer',
  'roles', 'role', 'permissionCatalog', 'users', 'teams', 'invitations',
  'quotes', 'quote', 'invoices', 'invoice', 'invoicePayments', 'catalogItems',
  'catalogTemplates', 'catalogTemplate', 'costingPolicy', 'quoteGuardrails',
  'channels', 'aiConfigs', 'channelIdentities', 'channelMessages',
  'automations', 'automation', 'automationExecutions', 'automationExecution',
  'financeOverview', 'financeAccounts', 'financeBudgets', 'financeSubscriptions',
  'financeJournalEntries', 'expenses', 'expense', 'aiBudget', 'aiUsage',
  'aiAgents', 'intentAgentConfig',
  'suppliers', 'supplier', 'supplierMaterials',
  'purchaseOrders', 'purchaseOrder', 'purchaseOrderGuardrails', 'purchasePolicy',
  'stock', 'stockLocations', 'reorderSuggestions', 'stockReconcile', 'goodsReceipts',
  'bills', 'bill', 'billMatch', 'billPayments', 'billAging', 'billableLines',
  'salesOrders', 'salesOrder', 'quoteSalesOrder',
  'workOrders', 'workOrder', 'workOrderVariance',
];

describe('api surface composition', () => {
  it('exposes exactly the expected endpoint sections', () => {
    expect(Object.keys(api).sort()).toEqual([...API_SECTIONS].sort());
  });

  it('exposes exactly the expected query keys', () => {
    expect(Object.keys(queryKeys).sort()).toEqual([...QUERY_KEYS].sort());
  });

  it('loses nothing to a spread collision', () => {
    const apiNames = SLICES.flatMap(([, endpoints]) => Object.keys(endpoints));
    const keyNames = SLICES.flatMap(([, , keys]) => Object.keys(keys));
    expect(apiNames.length, 'two slices declare the same endpoint section').toBe(Object.keys(api).length);
    expect(keyNames.length, 'two slices declare the same query key').toBe(Object.keys(queryKeys).length);
  });

  it('names each slice uniquely', () => {
    for (const [name, endpoints, keys] of SLICES) {
      const others = SLICES.filter(([n]) => n !== name);
      const otherApi = new Set(others.flatMap(([, e]) => Object.keys(e)));
      const otherKeys = new Set(others.flatMap(([, , k]) => Object.keys(k)));
      const clashA = Object.keys(endpoints).filter((k) => otherApi.has(k));
      const clashK = Object.keys(keys).filter((k) => otherKeys.has(k));
      expect(clashA, `${name} endpoint sections also declared elsewhere`).toEqual([]);
      expect(clashK, `${name} query keys also declared elsewhere`).toEqual([]);
    }
  });

  it('gives every endpoint section at least one callable', () => {
    for (const section of Object.keys(api)) {
      const value = api[section as keyof typeof api];
      expect(Object.keys(value).length, `${section} is empty`).toBeGreaterThan(0);
    }
  });

  it('keeps query keys array-valued or callable', () => {
    for (const [name, value] of Object.entries(queryKeys)) {
      const ok = Array.isArray(value) || typeof value === 'function';
      expect(ok, `${name} is neither a key array nor a key factory`).toBe(true);
    }
  });
});
