#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
if pg_isready -h 127.0.0.1 -p 15432 >/dev/null 2>&1; then echo 'Validation PostgreSQL port is occupied' >&2; exit 1; fi
if redis-cli -h 127.0.0.1 -p 16379 ping >/dev/null 2>&1; then echo 'Validation Redis port is occupied' >&2; exit 1; fi
task_dir="/tmp/rcs-validation-$(cat /proc/sys/kernel/random/uuid)"
install -d -m 700 -o postgres -g postgres "$task_dir" "$task_dir/postgres" "$task_dir/redis"
task_password="$(openssl rand -hex 32)"
printf '%s\n' "$task_password" > "$task_dir/password"
chown postgres:postgres "$task_dir/password"
chmod 600 "$task_dir/password"
runuser -u postgres -- /usr/lib/postgresql/18/bin/initdb -D "$task_dir/postgres" -U rcs_validation --auth-local=trust --auth-host=scram-sha-256 --pwfile="$task_dir/password" >/dev/null
runuser -u postgres -- /usr/lib/postgresql/18/bin/pg_ctl -D "$task_dir/postgres" -l "$task_dir/postgres.log" -o "-h 127.0.0.1 -p 15432 -k $task_dir/postgres" start >/dev/null
runuser -u postgres -- createdb -h "$task_dir/postgres" -p 15432 -U rcs_validation rcs_test
runuser -u postgres -- redis-server --port 16379 --bind 127.0.0.1 --requirepass "$task_password" --dir "$task_dir/redis" --daemonize yes --appendonly yes --logfile "$task_dir/redis.log"
umask 077
printf 'DATABASE_URL=postgresql://rcs_validation:%s@127.0.0.1:15432/rcs_test\nREDIS_URL=redis://:%s@127.0.0.1:16379/0\nVALIDATION_SERVICE_DIR=%s\n' "$task_password" "$task_password" "$task_dir" > .planning/validation-services.env
echo 'Isolated PostgreSQL 18 and Redis 8 started on loopback ports 15432 and 16379.'
