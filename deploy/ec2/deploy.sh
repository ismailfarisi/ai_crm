#!/bin/bash
# Runs on the EC2 host as root (via SSM Run Command):
#
#   IMAGE_TAG=<tag> REF=<git ref> bash /opt/ai_crm/deploy/ec2/deploy.sh
#
# Fetches the env from SSM, pulls the images, migrates, then recreates the app
# services. Postgres, Redis and Temporal are started if needed but never
# recreated, and the Postgres volume is never touched.
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG must be set}"
REF="${REF:-origin/master}"
REGION=ap-south-1
ECR_REGISTRY=100137600454.dkr.ecr.${REGION}.amazonaws.com
cd /opt/ai_crm

git fetch --quiet origin
git checkout --quiet --force "$REF"

umask 077
aws ssm get-parameter --region "$REGION" --name /ai-crm/production/env \
  --with-decryption --query Parameter.Value --output text > .env.production
printf 'ECR_REGISTRY=%s\nIMAGE_TAG=%s\n' "$ECR_REGISTRY" "$IMAGE_TAG" >> .env.production
umask 022

dc() {
  docker compose -p crm --env-file .env.production \
    -f docker-compose.staging.yml -f deploy/ec2/docker-compose.ec2.yml "$@"
}

aws ecr get-login-password --region "$REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null
dc pull --quiet api worker web marketing

dc up -d --wait postgres redis

# ts-node type-checking the whole API needs more memory than this box has;
# transpile-only runs the same migrations.
export DB_ADMIN_USERNAME DB_ADMIN_PASSWORD
DB_ADMIN_USERNAME="$(sed -n 's/^DB_ADMIN_USERNAME=//p' .env.production | head -n 1)"
DB_ADMIN_PASSWORD="$(sed -n 's/^DB_ADMIN_PASSWORD=//p' .env.production | head -n 1)"
dc run --rm --no-deps -e DB_ADMIN_USERNAME -e DB_ADMIN_PASSWORD \
  -e TS_NODE_TRANSPILE_ONLY=true -e NODE_OPTIONS=--max-old-space-size=512 \
  api pnpm migration:run
unset DB_ADMIN_USERNAME DB_ADMIN_PASSWORD

dc up -d temporal backup
dc up -d --no-deps --force-recreate api worker web marketing
dc up -d caddy

for i in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:4100/api/v1/health; then
    echo "api healthy"
    break
  fi
  [ "$i" = 60 ] && { dc logs --tail=80 api; exit 1; }
  sleep 5
done

docker image prune -f >/dev/null
dc ps
