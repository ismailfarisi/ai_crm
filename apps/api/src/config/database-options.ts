/**
 * Connection tuning shared by the Nest TypeORM module (API and worker) and the
 * standalone `AppDataSource` used by Temporal activities. Migrations build
 * their own data source and deliberately do not use this: a long backfill must
 * not be cut off by the request-sized statement timeout.
 */
export interface PgTuning {
  ssl: boolean;
  /**
   * Off by default because that is what staging has always run with (managed
   * Postgres certificates are not in the image's trust store). Turn it on once
   * the CA is available to the container.
   */
  sslRejectUnauthorized: boolean;
  /** Upper bound on connections per process — node-postgres' `max`. */
  poolMax: number;
  /** Server-side `statement_timeout`; 0 leaves the server default (none). */
  statementTimeoutMs: number;
  /**
   * Server-side `idle_in_transaction_session_timeout`; 0 leaves the server
   * default. Stops a leaked transaction from holding locks indefinitely.
   */
  idleInTransactionTimeoutMs: number;
}

export function pgConnectionOptions(tuning: PgTuning): {
  ssl: false | { rejectUnauthorized: boolean };
  extra: Record<string, number>;
} {
  const extra: Record<string, number> = { max: tuning.poolMax };
  // node-postgres sends these as startup parameters, so they apply to every
  // connection in the pool without an extra round trip.
  if (tuning.statementTimeoutMs > 0) {
    extra.statement_timeout = tuning.statementTimeoutMs;
  }
  if (tuning.idleInTransactionTimeoutMs > 0) {
    extra.idle_in_transaction_session_timeout =
      tuning.idleInTransactionTimeoutMs;
  }
  return {
    ssl: tuning.ssl
      ? { rejectUnauthorized: tuning.sslRejectUnauthorized }
      : false,
    extra,
  };
}
