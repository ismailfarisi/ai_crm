import { ApiError } from './client';

/** A readable line for a failed request, for toasts. */
export function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/** The server's own words (e.g. "needs bill:approve") beat a generic 403 line here. */
export function describeServer(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return describe(error, fallback);
}
