import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_TOKEN_COOKIE = 'crm_access_token';
const REFRESH_TOKEN_COOKIE = 'crm_refresh_token';

const PUBLIC_ROUTES = ['/login', '/register'];

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

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

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
