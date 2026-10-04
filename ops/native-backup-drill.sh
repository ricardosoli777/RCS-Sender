#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# -ne 3 ]]; then echo 'Usage: bash ops/native-backup-drill.sh ENV_FILE BACKUP_DIRECTORY NEW_DATABASE' >&2; exit 2; fi
target=$3
if [[ ! $target =~ ^rcs_restore_[a-z0-9_]{1,40}$ ]]; then echo 'Use a new rcs_restore_* database.' >&2; exit 2; fi
source_url=$(sed -n 's/^DATABASE_URL=//p' "$1" | tr -d '\r')
if [[ $source_url != postgresql://* && $source_url != postgres://* ]]; then echo 'DATABASE_URL required.' >&2; exit 2; fi
backup_directory=$(realpath -m "$2")
mkdir -p "$backup_directory"
backup="$backup_directory/rcs-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
pg_dump --dbname="$source_url" --format=custom --no-owner --no-acl > "$backup"
pg_restore --list "$backup" > "$backup.manifest"
sha256sum "$backup" > "$backup.sha256"
sha256sum -c "$backup.sha256"
# createdb fails if the target exists; no existing database can be replaced.
createdb --maintenance-db="$source_url" "$target"
restore_url=$(RCS_SOURCE_URL="$source_url" RCS_RESTORE_NAME="$target" python3 -c 'import os,urllib.parse; u=urllib.parse.urlsplit(os.environ["RCS_SOURCE_URL"]);print(urllib.parse.urlunsplit(u._replace(path="/"+os.environ["RCS_RESTORE_NAME"])))')
pg_restore --dbname="$restore_url" --exit-on-error --single-transaction --no-owner --no-acl "$backup"
query='SELECT count(*) FROM schema_migrations; SELECT count(*) FROM canonical_events; SELECT count(*) FROM journey_enrollments; SELECT count(*) FROM users; SELECT count(*) FROM campaigns;'
source_counts=$(psql "$source_url" -XAt -v ON_ERROR_STOP=1 -c "$query")
restored_counts=$(psql "$restore_url" -XAt -v ON_ERROR_STOP=1 -c "$query")
if [[ $source_counts != "$restored_counts" ]]; then echo 'Restore counts differ from source; keep writes stopped for a consistent drill.' >&2; exit 1; fi
printf 'Native backup and isolated restore verified. Database: %s\nBackup: %s\nCounts:\n%s\n' "$target" "$backup" "$restored_counts"
