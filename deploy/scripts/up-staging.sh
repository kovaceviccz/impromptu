#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deploy_root"

test -s .env.staging

compose() {
  docker compose --env-file .env.staging --file compose.staging.yaml "$@"
}

database_url=$(sed -n 's/^DATABASE_URL=//p' .env.staging | tr -d "'\"")
migration_url=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' .env.staging | tr -d "'\"")
case "$database_url" in
  postgresql://impromptu_staging:*@127.0.0.1:5432/impromptu_staging) ;;
  *) echo 'Expected the dedicated local PostgreSQL database.' >&2; exit 1 ;;
esac
test "$database_url" = "$migration_url"
sh scripts/up-database.sh

compose config --quiet
sh scripts/validate-envoy.sh
compose pull
compose run --rm --no-deps -T --entrypoint node app \
  apps/api/dist/migrate.js
compose run --rm --no-deps -T --entrypoint node \
  -e DEMO_PRIVATE_CODE=DEBATE26 app apps/api/dist/topics/seed-demo.js
compose up --detach --wait --wait-timeout 90 --remove-orphans
compose exec -T app \
  wget --quiet --spider http://127.0.0.1:3001/api/health

running_services=$(compose ps --status running --services)
for service in app livekit; do
  echo "$running_services" | grep -qx "$service"
done
