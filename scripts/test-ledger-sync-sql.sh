#!/usr/bin/env bash
# Disposable PostgreSQL instance, private Unix socket only. Never touches Supabase.
set -euo pipefail
if [[ -z "${PG_BIN:-}" ]]; then
  if [[ -x /opt/homebrew/opt/postgresql@17/bin/postgres ]]; then
    PG_BIN=/opt/homebrew/opt/postgresql@17/bin
  else
    PG_BIN="$(dirname "$(command -v postgres || true)")"
  fi
fi
if [[ ! -x "$PG_BIN/postgres" || ! -x "$PG_BIN/initdb" ]]; then
  echo 'PostgreSQL server tools are required. Set PG_BIN to their bin directory.' >&2
  exit 1
fi
sync_repo="$(cd "$(dirname "$0")/.." && pwd)"
sync_test_dir="$(mktemp -d /tmp/taxly-sync-sql.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$sync_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${sync_test_dir:?}"
}
trap cleanup EXIT
mkdir "$sync_test_dir/socket"
"$PG_BIN/initdb" -D "$sync_test_dir/data" -U postgres -A trust --encoding=UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$sync_test_dir/data" -o "-F -h '' -k $sync_test_dir/socket -p 55439" -l "$sync_test_dir/log" start >/dev/null
sync_psql() { "$PG_BIN/psql" -X -h "$sync_test_dir/socket" -p 55439 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
sync_psql <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SQL
sync_psql -f "$sync_repo/supabase/migrations/202610310001_ledger_sync.sql"
sync_psql -f "$sync_repo/supabase/tests/ledger_sync.sql"
echo 'Ledger RPC validation, replay, revision checks, and account isolation passed.'
