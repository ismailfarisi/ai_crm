/**
 * `server-only` throws if a module is pulled into a client bundle. There is no
 * bundle under test, and the package has no test build, so it is aliased to
 * this empty module in `vitest.config.ts`.
 */
export {};
