#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deploy_root"

docker compose config --quiet
test -s secrets/origin.pem
test -s secrets/origin-key.pem
openssl x509 -in secrets/origin.pem -noout -checkend 604800

certificate_key=$(openssl x509 -in secrets/origin.pem -pubkey -noout | \
  openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256)
private_key=$(openssl pkey -in secrets/origin-key.pem -pubout -outform DER 2>/dev/null | \
  openssl dgst -sha256)
test "$certificate_key" = "$private_key"

docker compose pull
docker compose up --detach --remove-orphans
docker compose exec -T app \
  wget --quiet --spider http://127.0.0.1:3000/api/health

running_services=$(docker compose ps --status running --services)
for service in app envoy livekit; do
  echo "$running_services" | grep -qx "$service"
done

docker image prune --all --force
