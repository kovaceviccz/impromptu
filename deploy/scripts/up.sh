#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deploy_root"

docker compose config --quiet
sh scripts/validate-envoy.sh

docker compose pull
docker compose up --detach --remove-orphans
docker compose restart envoy
docker compose exec -T app \
  wget --quiet --spider http://127.0.0.1:3000/api/health

running_services=$(docker compose ps --status running --services)
for service in app envoy livekit; do
  echo "$running_services" | grep -qx "$service"
done

docker image prune --all --force
