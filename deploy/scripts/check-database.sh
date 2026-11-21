#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deploy_root"
database_env=$(mktemp)
chmod 600 "$database_env"
for name in POSTGRES_PASSWORD PRODUCTION_DATABASE_PASSWORD STAGING_DATABASE_PASSWORD; do
  printf '%s=%s\n' "$name" "$(openssl rand -hex 24)" >> "$database_env"
done
export DATABASE_ENV_FILE="$database_env"
# CI uses a separate project, volume, and port; cleanup never touches live data.
export POSTGRES_BIND_PORT=0
compose() {
  docker compose --project-name "${COMPOSE_PROJECT_NAME:-impromptu}-database-check" --file compose.database.yaml "$@"
}
cleanup() {
  compose down --volumes --remove-orphans
  rm -f "$database_env"
}
trap cleanup EXIT INT TERM
compose config --quiet
compose up --detach --wait --wait-timeout 90
for environment in production staging; do
  role="impromptu_$environment"
  if [ "$environment" = production ]; then
    password=$(sed -n 's/^PRODUCTION_DATABASE_PASSWORD=//p' "$database_env")
    other=impromptu_staging
  else
    password=$(sed -n 's/^STAGING_DATABASE_PASSWORD=//p' "$database_env")
    other=impromptu_production
  fi
  compose exec -T -e PGPASSWORD="$password" postgres \
    psql -h 127.0.0.1 -U "$role" -d "$role" -v ON_ERROR_STOP=1 \
    -c 'CREATE TABLE persistence_check (value integer); INSERT INTO persistence_check VALUES (42);' >/dev/null
  if compose exec -T -e PGPASSWORD="$password" postgres \
    psql -h 127.0.0.1 -U "$role" -d "$other" -c 'SELECT 1' >/dev/null 2>&1; then
    echo 'Database roles must not access the other environment.' >&2
    exit 1
  fi
  if compose exec -T -e PGPASSWORD=wrong-password postgres \
    psql -h 127.0.0.1 -U "$role" -d "$role" -c 'SELECT 1' >/dev/null 2>&1; then
    echo 'TCP database connections must require a valid password.' >&2
    exit 1
  fi
done
compose restart postgres
compose up --detach --wait --wait-timeout 90
for environment in production staging; do
  test "$(compose exec -T postgres psql -U postgres -d "impromptu_$environment" \
    -Atc 'SELECT value FROM persistence_check')" = 42
done
