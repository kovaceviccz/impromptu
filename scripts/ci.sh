#!/bin/sh
set -eu

ci_stage='install dependencies'
report_failure() {
  result=$1
  if [ "$result" -ne 0 ]; then
    printf '::error file=scripts/ci.sh,title=CI gate failed::%s exited with status %s\n' \
      "$ci_stage" "$result" >&2
  fi
}
trap 'report_failure "$?"' EXIT

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

# Git Bash on Windows rewrites container paths such as /documents and passes
# /c/... host paths that Docker cannot mount. Keep container paths literal and
# give Docker Windows-style host paths instead.
host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s\n' "$1"
  fi
}
if command -v cygpath >/dev/null 2>&1; then
  export MSYS_NO_PATHCONV=1
fi
project_root=$(host_path "$project_root")

npm ci
ci_stage='check formatting'
npm run format:check
ci_stage='lint'
npm run lint
ci_stage='typecheck'
npm run typecheck
ci_stage='unit tests'
npm test
ci_stage='build'
npm run build

ci_stage='render documentation'
docs_output=$(host_path "$(mktemp -d)")
docker run --rm --user "$(id -u):$(id -g)" \
  --volume "$project_root/docs:/documents:ro" \
  --volume "$docs_output:/output" \
  asciidoctor/docker-asciidoctor:1.106.0@sha256:6266e05784c2d8ece9d9fe5e593b12c3beebebbc467135fd6f4a56269c93cea3 \
  asciidoctor -D /output /documents/index.adoc \
  /documents/architecture.adoc /documents/interface.adoc
test -f "$docs_output/index.html"
test -f "$docs_output/architecture.html"
test -f "$docs_output/interface.html"
rm -r "$docs_output"

ci_stage='validate workflows'
docker run --rm \
  --volume "$project_root:/repo" \
  --workdir /repo \
  rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 \
  .github/workflows/ci.yml .github/workflows/deploy.yml \
  .github/workflows/deploy-staging.yml .github/workflows/docs.yml

ci_stage='validate containers and infrastructure'
docker compose config --quiet
docker build --file deploy/Dockerfile --tag impromptu:ci .
sh deploy/scripts/check.sh

cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ]; then
    report_failure "$result"
    docker compose logs --no-color
  fi
  docker compose down --volumes --remove-orphans
  exit "$result"
}
trap cleanup EXIT INT TERM

ci_stage='start development stack'
docker compose down --volumes --remove-orphans
docker compose up --build --detach
attempt=0
until docker compose exec -T web wget -q -O /dev/null http://127.0.0.1:5173/api/health; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Development stack did not become ready" >&2
    exit 1
  fi
  sleep 1
done

ci_stage='check migrations'
docker compose exec -T postgres psql -U impromptu -d postgres \
  -c 'create database migration_check'
postgres_container=$(docker compose ps -q postgres)
for attempt in 1 2; do
  docker run --rm --network "container:$postgres_container" \
    --env MIGRATION_DATABASE_URL=postgresql://impromptu:impromptu@127.0.0.1:5432/migration_check \
    impromptu:ci node apps/api/dist/migrate.js
done
test "$(docker compose exec -T postgres psql -U impromptu -d migration_check \
  -Atc 'select count(*) from mikro_orm_migrations')" = 6
for table in account account_session private_lobby public_lobby_state; do
  test "$(docker compose exec -T postgres psql -U impromptu -d migration_check \
    -Atc "select to_regclass('public.$table')")" = "$table"
done
docker run --rm --network "container:$postgres_container" \
  --env DATABASE_URL=postgresql://impromptu:impromptu@127.0.0.1:5432/migration_check \
  impromptu:ci node --input-type=module -e '
    import { openDatabase } from "./apps/api/dist/database.js";
    const orm = await openDatabase(process.env.DATABASE_URL);
    try {
      const changes = await orm.schema.getUpdateSchemaSQL();
      if (changes.trim()) throw new Error(`Migration schema drift:\n${changes}`);
    } finally {
      await orm.close(true);
    }
  '

for attempt in 1 2; do
  docker run --rm --network "container:$postgres_container" \
    --env DATABASE_URL=postgresql://impromptu:impromptu@127.0.0.1:5432/migration_check \
    --env DEMO_PRIVATE_CODE=DEBATE26 \
    impromptu:ci node apps/api/dist/topics/seed-demo.js
done
test "$(docker compose exec -T postgres psql -U impromptu -d migration_check \
  -Atc "select count(*) from private_lobby where topic_id = id::text")" = 2

ci_stage='browser tests'
if command -v cygpath >/dev/null 2>&1; then
  # A Linux container cannot follow npm's Windows workspace links or share the
  # host network under Docker Desktop, so run Playwright on the host instead.
  npx playwright install chromium
  CI=1 PLAYWRIGHT_EXTERNAL_SERVER=1 \
    npx playwright test --config apps/web/playwright.config.ts
else
  docker run --rm --network host --ipc host \
    --env CI=1 \
    --env PLAYWRIGHT_EXTERNAL_SERVER=1 \
    --volume "$project_root:/work" \
    --workdir /work \
    mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 \
    npx playwright test --config apps/web/playwright.config.ts
fi
