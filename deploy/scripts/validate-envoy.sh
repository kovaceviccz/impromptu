#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$deploy_root"

for name in origin staging-origin; do
  test -s "secrets/$name.pem"
  test -s "secrets/$name-key.pem"
  openssl x509 -in "secrets/$name.pem" -noout -checkend 604800

  certificate_key=$(openssl x509 -in "secrets/$name.pem" -pubkey -noout | \
    openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256)
  private_key=$(openssl pkey -in "secrets/$name-key.pem" -pubout -outform DER 2>/dev/null | \
    openssl dgst -sha256)
  test "$certificate_key" = "$private_key"
done

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp \
  --volume "$deploy_root/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
  --volume "$deploy_root/secrets:/etc/envoy/tls:ro" \
  envoyproxy/envoy:distroless-v1.39.1@sha256:eb2c01c13125d1629637cb4e4cce7207009fb7cc2c8027f9742758549d15b6f4 \
  --mode validate -c /etc/envoy/envoy.yaml
