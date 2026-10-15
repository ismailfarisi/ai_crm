# Deployment

## Staging Host

The staging checkout lives at `/home/deploy/ai_crm` on SSH host `ismail`. The active Caddy configuration is `/etc/caddy/Caddyfile` (not `/home/deploy/Caddyfile`). Current routes are:

- `https://switeaz.com/` to the marketing site (`apps/marketing`) on `127.0.0.1:3200`. `https://www.switeaz.com/` redirects to it.
- `https://app.switeaz.com/` and `https://staging.switeaz.com/` to the CRM web container on `127.0.0.1:3100`.
- `https://api.switeaz.com/` and `https://api-staging.switeaz.com/` to the CRM API on `127.0.0.1:4100`.

The apex used to serve the app. The marketing site redirects every app path (`/q/…`, `/accept-invite`, `/dashboard`, and so on; see `apps/marketing/app-routes.mjs`) to the same path on `PUBLIC_WEB_URL`, so links already sent to customers keep working. Its own links into the app use `PUBLIC_WEB_URL` too. Set `MARKETING_SITE_URL` and, optionally, `MARKETING_CONTACT_EMAIL` in `.env.staging`; the defaults are `https://switeaz.com` and `hello@kerf.ae`. All of these are baked in at build time, so changing one means rebuilding `marketing`. Sessions survive the move between hosts because `COOKIE_DOMAIN` is `.switeaz.com`.

The canonical public web URL is `https://app.switeaz.com/`. Keep `PUBLIC_WEB_URL`, `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL`, and `PUBLIC_API_URL` aligned with the environment being deployed. Do not put credentials in this document or print `.env.staging`.

## Deploy

The following commands run on the staging host. Keep `.env.staging` and its backups untracked; never reset or remove the Postgres volume during a deployment.

1. Confirm the checkout has no tracked local edits, then fast-forward to the merged release:

   ```bash
   cd /home/deploy/ai_crm
   git status --short --branch
   git pull --ff-only origin master
   ```

2. Confirm `.env.staging` has separate database credentials:

   - `DB_ADMIN_USERNAME` and `DB_ADMIN_PASSWORD` identify the existing Postgres owner and are used only for migrations and provisioning.
   - `DB_USERNAME` and `DB_PASSWORD` identify a non-superuser role with `NOBYPASSRLS` used by the API and worker.

   For a fresh volume, Compose creates the app role during Postgres initialization. For an existing volume, back up `.env.staging`, set the admin values to the existing database owner and the app values to the restricted role, then recreate only the Postgres container so it receives the new environment and SQL mount:

   ```bash
   docker compose --env-file .env.staging -f docker-compose.staging.yml up -d postgres
   ```

   Provision the app role once, only if it does not already exist:

   ```bash
   docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T postgres \
     sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/10-create-db-app-role.sql'
   ```

3. Build the release images:

   ```bash
   docker compose --env-file .env.staging -f docker-compose.staging.yml build api worker web marketing
   ```

4. Apply pending migrations with the admin credentials. The API service intentionally removes `DB_ADMIN_*` from its normal runtime environment, so pass them only to this one-off command:

   ```bash
   export DB_ADMIN_USERNAME="$(sed -n 's/^DB_ADMIN_USERNAME=//p' .env.staging | head -n 1)"
   export DB_ADMIN_PASSWORD="$(sed -n 's/^DB_ADMIN_PASSWORD=//p' .env.staging | head -n 1)"
   docker compose --env-file .env.staging -f docker-compose.staging.yml run --rm --no-deps \
     -e DB_ADMIN_USERNAME -e DB_ADMIN_PASSWORD api pnpm migration:run
   unset DB_ADMIN_PASSWORD
   ```

5. Recreate the application services without restarting Postgres, Redis, or Temporal:

   ```bash
   docker compose --env-file .env.staging -f docker-compose.staging.yml \
     up -d --no-deps --force-recreate api worker web marketing
   ```

## Verify

Check service state and the API's database health:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
curl -fsS http://127.0.0.1:4100/api/v1/health
curl -I --max-time 10 https://switeaz.com/
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3200/
```

An unauthenticated web request may redirect to `/continue`; that is the expected sign-in gate. Confirm the worker logs report its task queues running and review API logs for startup or database-role errors:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml logs --tail=50 api worker web
```

The site blocks for the web hosts (DNS is a Cloudflare wildcard, so every subdomain already points here):

```caddy
switeaz.com {
	reverse_proxy 127.0.0.1:3200
}

www.switeaz.com {
	redir https://switeaz.com{uri} permanent
}

app.switeaz.com {
	reverse_proxy 127.0.0.1:3100
}
```

If a Caddy route changes, validate and reload the active config:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Do not automatically revert database migrations during an application rollback. If a migration has run, take a database backup and assess its rollback/data implications before changing schema state.
## Backups

The `backup` service in `docker-compose.staging.yml` takes a logical backup of the CRM database every night. It is a `postgres:18-alpine` container (so `pg_dump` matches the server) running `scripts/backup/pg-backup-loop.sh`, and it connects with the existing `DB_ADMIN_*` credentials — nothing new to store.

| Setting (in `.env.staging`) | Default | Meaning |
| --- | --- | --- |
| `BACKUP_DIR` | `../backups` | Host directory the dumps land in. From `/home/deploy/ai_crm` that is `~/backups`, alongside the existing per-sprint `*.sql.gz` files, which pruning never touches. |
| `BACKUP_HOUR_UTC` | `2` | Hour of the daily run, UTC. |
| `BACKUP_RETENTION_DAYS` | `14` | Dumps older than this are deleted — only after a successful run, so a broken backup never removes the good ones. |
| `BACKUP_UID` / `BACKUP_GID` | `1000` | Owner of the files; set to `id -u` / `id -g` of the deploy user. |

Each run writes `<db>_<UTC timestamp>.dump` (`pg_dump -Fc`, checked with `pg_restore --list` before it is kept) and `globals_<timestamp>.sql` (roles, from `pg_dumpall --globals-only`). Files are mode 600. If no dump is younger than a day when the container starts, it takes one immediately. The container turns unhealthy when the newest dump is more than 26 hours old.

Start it once (and after changing its settings):

```bash
mkdir -p ~/backups
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d backup
docker compose --env-file .env.staging -f docker-compose.staging.yml logs --tail=20 backup
```

Take one by hand before a risky deploy or migration:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml exec backup \
  sh -c 'pg_dump -Fc -f "/backups/${PGDATABASE}_manual_$(date -u +%Y%m%dT%H%M%SZ).dump" "$PGDATABASE"'
```

### Restore

Test a backup by restoring it into a database that does not exist yet — safe at any time, touches nothing live:

```bash
scripts/backup/restore.sh ~/backups/crm_20261014T020000Z.dump crm_restore_check
# inspect it, then
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T postgres \
  sh -c 'dropdb -U "$POSTGRES_USER" crm_restore_check'
```

To replace the live database, stop everything that writes to it, restore, then start them again:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml stop api worker
scripts/backup/restore.sh ~/backups/<file>.dump "$(sed -n 's/^DB_NAME=//p' .env.staging)" --replace-live
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d api worker
```

The restore keeps owners and grants as dumped, so the app role (`DB_USERNAME`) must exist — it does on the same cluster. On a rebuilt cluster, restore `globals_<timestamp>.sql` first with `psql -U "$POSTGRES_USER" -d postgres -f …` inside the postgres container.

### What this does not cover yet

- **The dumps live on the same host as the database.** Losing the disk loses both. The next step is copying `~/backups` off the host daily (an `rclone`/`aws s3 sync` cron to a bucket with object versioning and its own retention).
- **Recovery point is up to 24 hours.** For point-in-time recovery, add WAL archiving (`archive_mode=on` with `pgBackRest` or `wal-g` to object storage) on top of a periodic base backup. Logical dumps then become the secondary, easy-to-inspect copy.
- **Temporal's own databases (`temporal`, `temporal_visibility`) are not dumped.** Losing them loses in-flight workflow state, not CRM data; automation executions are recorded in the CRM database.

## Temporal version

Staging pins `temporalio/auto-setup` to `TEMPORAL_VERSION` (default `1.29.3`, which is what `latest` resolved to when it was pinned). `auto-setup` migrates Temporal's schema on start and a schema cannot be downgraded, so before deploying a different pin check what is running:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml images temporal
docker image inspect --format '{{index .RepoDigests 0}}' "$(docker inspect --format '{{.Image}}' crm_staging_temporal)"
```

If the container was started from `latest` some time ago, compare its digest with the tags on Docker Hub to find the version it really is.

Never set `TEMPORAL_VERSION` lower than the running version. Upgrade one minor version at a time, after a backup. Local development uses the in-memory CLI dev server (`temporalio/temporal:1.9.1`), which has no such constraint.

## Event outbox

CRM domain events and audit rows whose first insert failed are delivered through the `crm_event_outbox` table (migration `1789600000000-CreateCrmEventOutbox`, applied by the normal migration step). The API process drains it; the worker only writes to it. Rows that exhausted `EVENT_OUTBOX_MAX_ATTEMPTS` are kept as `DEAD` with their last error:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT status, kind, count(*) FROM crm_event_outbox GROUP BY 1, 2"'
```

To retry dead rows after fixing the cause: `UPDATE crm_event_outbox SET status = 'PENDING', attempts = 0, available_at = now() WHERE status = 'DEAD';`.
