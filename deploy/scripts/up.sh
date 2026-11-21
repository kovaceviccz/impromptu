#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deploy_root"

database_url=$(sed -n 's/^DATABASE_URL=//p' .env | tr -d "'\"")
migration_url=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' .env | tr -d "'\"")
case "$database_url" in
  postgresql://impromptu_production:*@127.0.0.1:5432/impromptu_production) ;;
  *) echo 'Expected the dedicated local PostgreSQL database.' >&2; exit 1 ;;
esac
test "$database_url" = "$migration_url"
sh scripts/up-database.sh

docker compose config --quiet
sh scripts/validate-envoy.sh

docker compose pull
docker compose run --rm --no-deps -T --entrypoint node app \
  apps/api/dist/migrate.js
docker compose run --rm --no-deps -T --entrypoint node \
  -e DEMO_PRIVATE_CODE=DEBATE26 app apps/api/dist/topics/seed-demo.js
docker compose up --detach --wait --wait-timeout 90 --remove-orphans
docker compose restart envoy
docker compose exec -T app \
  wget --quiet --spider http://127.0.0.1:3000/api/health

running_services=$(docker compose ps --status running --services)
for service in app envoy livekit; do
  echo "$running_services" | grep -qx "$service"
done
