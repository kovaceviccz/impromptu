#!/bin/sh
set -eu

# The official image runs this only when initializing an empty data volume.
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --set production_password="$PRODUCTION_DATABASE_PASSWORD" \
  --set staging_password="$STAGING_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE impromptu_production LOGIN PASSWORD :'production_password';
CREATE ROLE impromptu_staging LOGIN PASSWORD :'staging_password';
CREATE DATABASE impromptu_production OWNER impromptu_production;
CREATE DATABASE impromptu_staging OWNER impromptu_staging;
REVOKE ALL ON DATABASE impromptu_production FROM PUBLIC;
REVOKE ALL ON DATABASE impromptu_staging FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
SQL
