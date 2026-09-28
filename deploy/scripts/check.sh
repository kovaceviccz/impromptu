#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

APP_IMAGE=impromptu:ci \
  LIVEKIT_API_KEY=ci-key \
  LIVEKIT_API_SECRET=ci-secret-at-least-32-characters-long \
  LIVEKIT_HOSTNAME=livekit.example.com \
  docker compose --project-directory "$deploy_root" \
    --file "$deploy_root/compose.yaml" config --quiet

envoy_tls_directory=$(mktemp -d)
cleanup_envoy_tls() {
  if [ -d "$envoy_tls_directory" ]; then
    find "$envoy_tls_directory" -type f -delete
    rmdir "$envoy_tls_directory"
  fi
}
trap cleanup_envoy_tls EXIT INT TERM

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$envoy_tls_directory/origin-key.pem" \
  -out "$envoy_tls_directory/origin.pem" \
  -days 1 -subj /CN=localhost >/dev/null 2>&1
chmod 755 "$envoy_tls_directory"
chmod 640 "$envoy_tls_directory/origin-key.pem"
chmod 644 "$envoy_tls_directory/origin.pem"
docker run --rm \
  --user "0:$(id -g)" \
  --cap-drop ALL \
  --cap-add NET_BIND_SERVICE \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp \
  --volume "$deploy_root/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
  --volume "$envoy_tls_directory:/etc/envoy/tls:ro" \
  envoyproxy/envoy:distroless-v1.39.1@sha256:eb2c01c13125d1629637cb4e4cce7207009fb7cc2c8027f9742758549d15b6f4 \
  --mode validate -c /etc/envoy/envoy.yaml

cleanup_envoy_tls
trap - EXIT INT TERM

tofu_image=ghcr.io/opentofu/opentofu:1.12.6@sha256:22cb52f6c5bf5c72a48a8f56d993d8df3e9462b1cdfb5db7e77143c87e8d159f
docker run --rm --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$deploy_root/opentofu:/workspace" \
  --workdir /workspace \
  "$tofu_image" fmt -check -recursive
docker run --rm --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$deploy_root/opentofu:/workspace" \
  --workdir /workspace \
  "$tofu_image" init -backend=false -lockfile=readonly
docker run --rm --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$deploy_root/opentofu:/workspace" \
  --workdir /workspace \
  "$tofu_image" validate
