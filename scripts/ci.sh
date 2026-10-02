#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build

docs_output=$(mktemp -d)
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

docker run --rm \
  --volume "$project_root:/repo" \
  --workdir /repo \
  rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 \
  .github/workflows/ci.yml .github/workflows/deploy.yml \
  .github/workflows/deploy-staging.yml .github/workflows/docs.yml

docker compose config --quiet
docker build --file deploy/Dockerfile --tag impromptu:ci .
sh deploy/scripts/check.sh

cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ]; then
    docker compose logs --no-color
  fi
  docker compose down --volumes --remove-orphans
  exit "$result"
}
trap cleanup EXIT INT TERM

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

docker compose exec -T postgres psql -U impromptu -d postgres \
  -c 'create database migration_check'
postgres_container=$(docker compose ps -q postgres)
for attempt in 1 2; do
  docker run --rm --network "container:$postgres_container" \
    --env MIGRATION_DATABASE_URL=postgresql://impromptu:impromptu@127.0.0.1:5432/migration_check \
    impromptu:ci node apps/api/dist/migrate.js
done
test "$(docker compose exec -T postgres psql -U impromptu -d migration_check \
  -Atc 'select count(*) from mikro_orm_migrations')" = 1
test "$(docker compose exec -T postgres psql -U impromptu -d migration_check \
  -Atc "select to_regclass('public.private_lobby')")" = private_lobby
docker run --rm --network "container:$postgres_container" \
  --env DATABASE_URL=postgresql://impromptu:impromptu@127.0.0.1:5432/migration_check \
  impromptu:ci node --input-type=module -e '
    import { createPostgresPrivateLobbyStore } from "./apps/api/dist/lobbies/postgres-store.js";
    const { orm } = await createPostgresPrivateLobbyStore(process.env.DATABASE_URL);
    try {
      const changes = await orm.schema.getUpdateSchemaSQL();
      if (changes.trim()) throw new Error(`Migration schema drift:\n${changes}`);
    } finally {
      await orm.close(true);
    }
  '

docker run --rm --network host --ipc host \
  --env CI=1 \
  --env PLAYWRIGHT_EXTERNAL_SERVER=1 \
  --volume "$project_root:/work" \
  --workdir /work \
  mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 \
  npx playwright test --config apps/web/playwright.config.ts
