#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# -ne 2 ]]; then echo 'Usage: bash ops/backup.sh ENV_FILE BACKUP_DIRECTORY' >&2; exit 2; fi
env_file=$(realpath "$1")
backup_directory=$(realpath -m "$2")
mkdir -p "$backup_directory"
backup="$backup_directory/rcs-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
docker compose --env-file "$env_file" -f ops/compose.yaml exec -T postgres pg_dump -U rcs_sender -d rcs_sender --format=custom --no-owner --no-acl > "$backup"
docker compose --env-file "$env_file" -f ops/compose.yaml exec -T postgres pg_restore --list < "$backup" > "$backup.manifest"
sha256sum "$backup" > "$backup.sha256"
printf 'Backup written: %s\n' "$backup"
