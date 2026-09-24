#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
credentials_file="$deploy_root/opentofu/.env"

if [ ! -f "$credentials_file" ]; then
  echo "Create deploy/opentofu/.env from .env.example first." >&2
  exit 1
fi

set -a
. "$credentials_file"
set +a

: "${HCLOUD_TOKEN:?Set HCLOUD_TOKEN in deploy/opentofu/.env}"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN in deploy/opentofu/.env}"

origin_csr_file="$deploy_root/secrets/origin.csr"
if [ -s "$origin_csr_file" ]; then
  TF_VAR_origin_csr=$(sed -n '1,$p' "$origin_csr_file")
  export TF_VAR_origin_csr
fi

tofu_image=ghcr.io/opentofu/opentofu:1.12.6@sha256:22cb52f6c5bf5c72a48a8f56d993d8df3e9462b1cdfb5db7e77143c87e8d159f
exec docker run --rm --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --env HCLOUD_TOKEN \
  --env CLOUDFLARE_API_TOKEN \
  --env TF_VAR_origin_csr \
  --volume "$deploy_root/opentofu:/workspace" \
  --workdir /workspace \
  "$tofu_image" "$@"
