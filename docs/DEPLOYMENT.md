# Deployment

## Staging Host

The staging checkout lives at `/home/deploy/ai_crm` on SSH host `ismail`. The active Caddy configuration is `/etc/caddy/Caddyfile` (not `/home/deploy/Caddyfile`). Current routes are:

- `https://switeaz.com/` and `https://staging.switeaz.com/` to the CRM web container on `127.0.0.1:3100`.
- `https://api.switeaz.com/` and `https://api-staging.switeaz.com/` to the CRM API on `127.0.0.1:4100`.

The canonical public web URL is `https://switeaz.com/`. Keep `PUBLIC_WEB_URL`, `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL`, and `PUBLIC_API_URL` aligned with the environment being deployed. Do not put credentials in this document or print `.env.staging`.

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
   docker compose --env-file .env.staging -f docker-compose.staging.yml build api worker web
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
     up -d --no-deps --force-recreate api worker web
   ```

## Verify

Check service state and the API's database health:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
curl -fsS http://127.0.0.1:4100/api/v1/health
curl -I --max-time 10 https://switeaz.com/
```

An unauthenticated web request may redirect to `/continue`; that is the expected sign-in gate. Confirm the worker logs report its task queues running and review API logs for startup or database-role errors:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml logs --tail=50 api worker web
```

If a Caddy route changes, validate and reload the active config:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Do not automatically revert database migrations during an application rollback. If a migration has run, take a database backup and assess its rollback/data implications before changing schema state.