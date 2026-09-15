/**
 * Every endpoint the browser talks to, in one typed surface.
 *
 * Assembled from one file per feature area rather than held in a single
 * module, so that adding endpoints is a new file plus three additive lines
 * here — an import, a spread into `api`, and a spread into `queryKeys`.
 */
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
import { creditsEndpoints, creditsKeys } from './credits';

export * from './auth';
export * from './contacts';
export * from './customers';
export * from './rbac';
export * from './sales';
export * from './channels';
export * from './automations';
export * from './finance';
export * from './ai';
export * from './purchasing';
export * from './inventory';
export * from './payables';
export * from './orders';
export * from './production';
export * from './credits';

export const api = {
  ...authEndpoints,
  ...contactsEndpoints,
  ...customersEndpoints,
  ...rbacEndpoints,
  ...salesEndpoints,
  ...channelsEndpoints,
  ...automationsEndpoints,
  ...financeEndpoints,
  ...aiEndpoints,
  ...purchasingEndpoints,
  ...inventoryEndpoints,
  ...payablesEndpoints,
  ...ordersEndpoints,
  ...productionEndpoints,
  ...creditsEndpoints,
};

export const queryKeys = {
  ...authKeys,
  ...contactsKeys,
  ...customersKeys,
  ...rbacKeys,
  ...salesKeys,
  ...channelsKeys,
  ...automationsKeys,
  ...financeKeys,
  ...aiKeys,
  ...purchasingKeys,
  ...inventoryKeys,
  ...payablesKeys,
  ...ordersKeys,
  ...productionKeys,
  ...creditsKeys,
};
