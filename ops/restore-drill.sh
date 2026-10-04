#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# -ne 3 ]]; then echo 'Usage: bash ops/restore-drill.sh ENV_FILE BACKUP RESTORE_DATABASE' >&2; exit 2; fi
env_file=$(realpath "$1")
backup=$(realpath "$2")
sha256sum -c "$backup.sha256"
target=$3
# Only a NEW isolated database is accepted; production cannot be named here.
if [[ ! $target =~ ^rcs_restore_[a-z0-9_]{1,40}$ ]]; then echo 'Use a new rcs_restore_* database.' >&2; exit 2; fi
compose=(docker compose --env-file "$env_file" -f ops/compose.yaml)
"${compose[@]}" exec -T postgres createdb -U rcs_sender "$target"
"${compose[@]}" exec -T postgres pg_restore -U rcs_sender --dbname="$target" --exit-on-error --single-transaction --no-owner --no-acl < "$backup"
"${compose[@]}" exec -T postgres psql -U rcs_sender -d "$target" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS migrations FROM schema_migrations; SELECT count(*) AS events FROM canonical_events; SELECT count(*) AS enrollments FROM journey_enrollments;'
printf 'Isolated restore completed in %s. Production was not changed.\n' "$target"
