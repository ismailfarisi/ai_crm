export const ACCESS_TOKEN_COOKIE = 'crm_access_token';
export const REFRESH_TOKEN_COOKIE = 'crm_refresh_token';

/** Scoped so the refresh cookie is never sent on ordinary API calls. */
export const REFRESH_COOKIE_PATH_SUFFIX = '/auth';
