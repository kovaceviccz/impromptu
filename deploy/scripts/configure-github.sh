#!/bin/sh
set -eu

deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repository=${GITHUB_REPOSITORY:-kovaceviccz/impromptu}
auto_deploy=${1:-false}
github_token_file="$deploy_root/secrets/github-token"

case "$auto_deploy" in
  true|false) ;;
  *)
    echo "Usage: $0 [true|false]" >&2
    exit 1
    ;;
esac

for command in gh docker; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required." >&2
    exit 1
  fi
done

if [ -s "$github_token_file" ]; then
  GH_TOKEN=$(sed -n '1p' "$github_token_file")
  export GH_TOKEN
elif ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Authenticate gh or save a token in deploy/secrets/github-token." >&2
  exit 1
fi

for file in \
  "$deploy_root/.env" \
  "$deploy_root/secrets/deploy_ed25519" \
  "$deploy_root/secrets/known_hosts" \
  "$deploy_root/secrets/origin.pem" \
  "$deploy_root/secrets/origin-key.pem"; do
  if [ ! -s "$file" ]; then
    echo "Missing $file" >&2
    exit 1
  fi
done

set -a
. "$deploy_root/.env"
set +a

: "${APP_HOSTNAME:?Set APP_HOSTNAME in deploy/.env}"
: "${DATABASE_URL:?Set DATABASE_URL in deploy/.env}"
: "${LIVEKIT_API_KEY:?Set LIVEKIT_API_KEY in deploy/.env}"
: "${LIVEKIT_API_SECRET:?Set LIVEKIT_API_SECRET in deploy/.env}"
: "${LIVEKIT_HOSTNAME:?Set LIVEKIT_HOSTNAME in deploy/.env}"

deploy_host=$(sh "$deploy_root/scripts/tofu.sh" output -raw server_ipv4)

gh api --method PUT "repos/$repository/environments/production" >/dev/null
gh variable set AUTO_DEPLOY_ENABLED --repo "$repository" --body "$auto_deploy"
gh variable set APP_HOSTNAME --repo "$repository" --env production \
  --body "$APP_HOSTNAME"
gh variable set LIVEKIT_HOSTNAME --repo "$repository" --env production \
  --body "$LIVEKIT_HOSTNAME"

printf '%s' "$deploy_host" |
  gh secret set DEPLOY_HOST --repo "$repository" --env production
printf '%s' "$DATABASE_URL" |
  gh secret set DATABASE_URL --repo "$repository" --env production
gh secret set DEPLOY_SSH_KEY --repo "$repository" --env production \
  < "$deploy_root/secrets/deploy_ed25519"
gh secret set DEPLOY_KNOWN_HOSTS --repo "$repository" --env production \
  < "$deploy_root/secrets/known_hosts"
printf '%s' "$LIVEKIT_API_KEY" |
  gh secret set LIVEKIT_API_KEY --repo "$repository" --env production
printf '%s' "$LIVEKIT_API_SECRET" |
  gh secret set LIVEKIT_API_SECRET --repo "$repository" --env production
gh secret set ORIGIN_CERTIFICATE --repo "$repository" --env production \
  < "$deploy_root/secrets/origin.pem"
gh secret set ORIGIN_PRIVATE_KEY --repo "$repository" --env production \
  < "$deploy_root/secrets/origin-key.pem"

echo "Configured the production environment for $repository."
echo "Automatic main deployment: $auto_deploy"
