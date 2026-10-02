#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deploy_root"

test -s .env.staging
DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' .env.staging)
MIGRATION_DATABASE_URL=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' .env.staging)

: "${DATABASE_URL:?Set staging DATABASE_URL}"
: "${MIGRATION_DATABASE_URL:?Set staging MIGRATION_DATABASE_URL}"
case "$DATABASE_URL" in
  *@ep-restless-queen-b4m0ao4e-pooler.c-6.us-east-2.aws.neon.tech/*) ;;
  *)
    echo 'Staging DATABASE_URL must use the dedicated Neon branch.' >&2
    exit 1
    ;;
esac
case "$MIGRATION_DATABASE_URL" in
  *@ep-restless-queen-b4m0ao4e.c-6.us-east-2.aws.neon.tech/*) ;;
  *)
    echo 'Staging MIGRATION_DATABASE_URL must use the direct Neon branch endpoint.' >&2
    exit 1
    ;;
esac

compose() {
  docker compose --env-file .env.staging --file compose.staging.yaml "$@"
}

compose config --quiet
sh scripts/validate-envoy.sh
compose pull
compose run --rm --no-deps -T --entrypoint node app \
  apps/api/dist/migrate.js
compose up --detach --wait --wait-timeout 90 --remove-orphans
compose exec -T app \
  wget --quiet --spider http://127.0.0.1:3001/api/health

running_services=$(compose ps --status running --services)
for service in app livekit; do
  echo "$running_services" | grep -qx "$service"
done
