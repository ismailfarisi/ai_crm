import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_TOKEN_COOKIE = 'crm_access_token';
const REFRESH_TOKEN_COOKIE = 'crm_refresh_token';

/**
 * Set by `/continue` just before it tries a refresh, and cleared as soon as an
 * access token is seen again. Its only job is to stop a refresh that cannot
 * succeed — a revoked session, a misconfigured cookie domain — from bouncing
 * between here and `/continue` forever.
 */
const REFRESH_ATTEMPT_COOKIE = 'crm_refresh_try';

/** Where the browser goes to spend a refresh token the server cannot see. */
const CONTINUE_ROUTE = '/continue';

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
const OPEN_ROUTES = ['/accept-invite', '/q', CONTINUE_ROUTE];

const matches = (pathname: string, routes: string[]) =>
  routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

/**
 * Next 16 renamed the `middleware` convention to `proxy`. This is a cheap
 * cookie-presence gate to avoid flashing the app shell at signed-out users —
 * the real authorization happens in the API on every request.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasSession =
    request.cookies.has(ACCESS_TOKEN_COOKIE) || request.cookies.has(REFRESH_TOKEN_COOKIE);
  const triedRefresh = request.cookies.has(REFRESH_ATTEMPT_COOKIE);

  if (matches(pathname, OPEN_ROUTES)) {
    return NextResponse.next();
  }

  const isPublicRoute = matches(pathname, PUBLIC_ROUTES);

  if (!hasSession && !isPublicRoute) {
    const destination = pathname === '/' ? null : pathname + request.nextUrl.search;

    /*
     * The access token expires after 15 minutes while the refresh token is
     * good for far longer — so this is usually someone still signed in, not
     * someone signed out. It used to be a redirect to /login, which is why a
     * plain navigation dropped the session about every quarter of an hour.
     *
     * The refresh cookie is scoped to the API's auth routes and never reaches
     * this server, so the refresh has to happen in the browser. `/continue`
     * does it and comes back. Once it has tried, `crm_refresh_try` is set and
     * /login is the honest answer.
     */
    if (!triedRefresh) {
      const continueUrl = new URL(CONTINUE_ROUTE, request.url);
      if (destination) continueUrl.searchParams.set('next', destination);
      return NextResponse.redirect(continueUrl);
    }

    const loginUrl = new URL('/login', request.url);
    if (destination) loginUrl.searchParams.set('next', destination);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(REFRESH_ATTEMPT_COOKIE);
    return response;
  }

  if (hasSession && isPublicRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Signed in again: drop the marker so the next expiry gets its own attempt.
  if (hasSession && triedRefresh) {
    const response = NextResponse.next();
    response.cookies.delete(REFRESH_ATTEMPT_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals, the favicon and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
