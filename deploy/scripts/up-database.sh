#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deploy_root"
test -s secrets/database.env

docker compose --file compose.database.yaml config --quiet
docker compose --file compose.database.yaml up --detach --wait --wait-timeout 90
