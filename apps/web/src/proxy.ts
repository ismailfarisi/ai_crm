import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_TOKEN_COOKIE = 'crm_access_token';
const REFRESH_TOKEN_COOKIE = 'crm_refresh_token';

/** Signed-out only: a signed-in visitor is sent on to the dashboard. */
const PUBLIC_ROUTES = ['/login', '/register'];

/**
 * Reachable either way, and never redirected.
 *
 * `/accept-invite` was missing entirely, so an invitee — who by definition has
 * no session — was bounced to /login and could never set a password. It is not
 * in PUBLIC_ROUTES either: someone already signed in on the browser may still
 * need to open an invite for a different account.
 *
 * `/q` is a customer's quote acceptance link.
 */
const OPEN_ROUTES = ['/accept-invite', '/q'];

const matches = (pathname: string, routes: string[]) =>
  routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

/**
 * Next 16 renamed the `middleware` convention to `proxy`. This is a cheap
 * cookie-presence gate to avoid flashing the app shell at signed-out users —
 * the real authorization happens in the API on every request.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // A valid session may hold only a refresh token if the access token just
  // expired; the layout's server fetch will refresh it.
  const hasSession =
    request.cookies.has(ACCESS_TOKEN_COOKIE) || request.cookies.has(REFRESH_TOKEN_COOKIE);

  if (matches(pathname, OPEN_ROUTES)) {
    return NextResponse.next();
  }

  const isPublicRoute = matches(pathname, PUBLIC_ROUTES);

  if (!hasSession && !isPublicRoute) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && isPublicRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals, the favicon and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
