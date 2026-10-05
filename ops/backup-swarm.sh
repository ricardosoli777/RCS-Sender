#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# -lt 1 || $# -gt 2 ]]; then echo 'Usage: bash ops/backup-swarm.sh BACKUP_DIRECTORY [NEW_RESTORE_DATABASE]' >&2; exit 2; fi
directory=$(realpath -m "$1")
mkdir -p "$directory"
mapfile -t containers < <(docker ps -q --filter label=com.docker.swarm.service.name=rcssender_postgres)
if [[ ${#containers[@]} -ne 1 ]]; then echo 'Exactly one RCS PostgreSQL task required.' >&2; exit 1; fi
container=${containers[0]}
backup="$directory/rcssender-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
docker exec "$container" pg_dump -U rcs_sender -d rcs_sender --format=custom --no-owner --no-acl > "$backup"
docker exec -i "$container" pg_restore --list < "$backup" > "$backup.manifest"
sha256sum "$backup" > "$backup.sha256"
sha256sum -c "$backup.sha256"
if [[ $# -eq 2 ]]; then
  target=$2
  if [[ ! $target =~ ^rcs_restore_[a-z0-9_]{1,40}$ ]]; then echo 'New rcs_restore_* database required.' >&2; exit 2; fi
  docker exec "$container" createdb -U rcs_sender "$target"
  docker exec -i "$container" pg_restore -U rcs_sender -d "$target" --exit-on-error --single-transaction --no-owner --no-acl < "$backup"
  query='SELECT count(*) FROM schema_migrations; SELECT count(*) FROM users; SELECT count(*) FROM canonical_events; SELECT count(*) FROM journey_enrollments; SELECT count(*) FROM journey_transitions;'
  source_counts=$(docker exec "$container" psql -U rcs_sender -d rcs_sender -XAt -v ON_ERROR_STOP=1 -c "$query")
  restore_counts=$(docker exec "$container" psql -U rcs_sender -d "$target" -XAt -v ON_ERROR_STOP=1 -c "$query")
  if [[ $source_counts != "$restore_counts" ]]; then echo 'Count mismatch; preserve writes stopped for the drill.' >&2; exit 1; fi
  printf 'Restore verified in %s. Counts:\n%s\n' "$target" "$restore_counts"
fi
printf 'Backup verified: %s\n' "$backup"
