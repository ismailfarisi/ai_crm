/**
 * Top-level routes that belong to the CRM (apps/web), not to this site.
 *
 * The marketing site took over the domain the app used to live on, so links
 * already out in the world — a customer's quote link (/q/…), an invite
 * (/accept-invite), a bookmarked /dashboard — arrive here. Each is redirected
 * to the same path on the app's domain. `app-routes.test.mjs` fails when
 * apps/web gains a top-level route this list does not cover.
 */
export const APP_ROUTES = [
  // (auth)
  'accept-invite',
  'continue',
  'login',
  'register',
  // public quote acceptance
  'q',
  // (app)
  'assistant',
  'automations',
  'catalog',
  'contacts',
  'customers',
  'dashboard',
  'finance',
  'inbox',
  'inventory',
  'invoices',
  'objects',
  'orders',
  'people',
  'production',
  'purchasing',
  'quotes',
  'settings',
];

/** Next.js redirect rules sending every app route, sub-paths and query included, to `appUrl`. */
export function appRedirects(appUrl) {
  const base = appUrl.replace(/\/$/, '');
  return APP_ROUTES.map((route) => ({
    // `:path*` matches zero or more segments, so this covers /route itself too.
    source: `/${route}/:path*`,
    destination: `${base}/${route}/:path*`,
    // Temporary: a browser caches a permanent redirect, and the app's domain
    // may move again before launch.
    permanent: false,
  }));
}
