#!/bin/sh
# Copyright 1999-2026 Alibaba Group Holding Ltd.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
set -eu
umask 077
: "${CF_INIT_CONFIG_FILE:?Set CF_INIT_CONFIG_FILE}"
[ -f "$CF_INIT_CONFIG_FILE" ] && [ -r "$CF_INIT_CONFIG_FILE" ] || {
  echo "Initialization configuration file is not readable" >&2; exit 2;
}
work=$(mktemp -d "${TMPDIR:-/tmp}/cf-startup-import.XXXXXX")
child=''
import_pid=''
completion=''
cleanup() {
  status=$?
  trap - EXIT TERM INT HUP
  if [ -n "$import_pid" ]; then kill -TERM "$import_pid" 2>/dev/null || true; fi
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  if [ -n "$completion" ]; then rm -f "$completion"; fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
name=$(basename "$CF_INIT_CONFIG_FILE")
mkdir "$work/input"
cp "$CF_INIT_CONFIG_FILE" "$work/input/$name"
file="$work/input/$name"
namespace=${CF_INIT_NAMESPACE:-public}
group=${CF_INIT_GROUP:-DEFAULT_GROUP}
username=${CF_INIT_USERNAME:-${CF_USERNAME:-nacos}}
overwrite=${CF_INIT_OVERWRITE:-false}
case "$overwrite" in true|false) ;; *) echo "CF_INIT_OVERWRITE must be true or false" >&2; exit 2 ;; esac
timeout=${CF_INIT_TIMEOUT:-120}
case "$timeout" in ''|*[!0-9]*) echo "CF_INIT_TIMEOUT must be a positive integer" >&2; exit 2 ;; esac
[ "$timeout" -gt 0 ] || { echo "CF_INIT_TIMEOUT must be positive" >&2; exit 2; }
case "$name" in
  *.[zZ][iI][pP])
    [ -z "${CF_INIT_GROUP:-}${CF_INIT_DATA_ID:-}${CF_INIT_TYPE:-}" ] || {
      echo "ZIP groups, names and types come from archive metadata" >&2; exit 2;
    } ;;
esac
server=$(cat /tmp/cf-server-api-url)
checksum=$(sha256sum < "$file" | cut -d ' ' -f 1)
key=$(printf '%s\000' "$checksum" "$name" "$namespace" "$group" "${CF_INIT_DATA_ID:-}" \
  "${CF_INIT_TYPE:-}" "$overwrite" "$server" "${DB_URL:-derby}" "${DB_USER:-}" "${DB_SCHEMA:-}" \
  | sha256sum | cut -d ' ' -f 1)
state="${NACOS_HOME}/data/init-import"
mkdir -p "$state"
rm -f /tmp/cf-server-import-ready
# Java must not inherit configuration-import credentials unnecessarily.
(
  unset CF_INIT_ADMIN_PASSWORD CF_INIT_PASSWORD CF_PASSWORD CF_INIT_TOKEN CF_TOKEN
  exec "$@"
) &
child=$!
# Readiness calls are reads; writes below are never retried after ambiguous timeouts.
deadline=$(( $(date +%s) + timeout ))
until curl --disable --silent --fail --max-time 3 "$server/v3/admin/core/state/readiness" > "$work/readiness" 2>/dev/null \
  && jq -e '.code == 0 and .data == "ok"' "$work/readiness" > /dev/null 2>&1; do
  kill -0 "$child" 2>/dev/null || { echo "Server exited before initialization import" >&2; exit 1; }
  [ "$(date +%s)" -lt "$deadline" ] || { echo "Timed out waiting for server before initialization import" >&2; exit 1; }
  sleep 1
done
if [ -f "$state/$key.done" ]; then
  echo "Initialization import: unchanged file and target already completed"
else
  export CF_AUTH_WAIT_SECONDS=${CF_AUTH_WAIT_SECONDS:-60}
  admin_file=''
  if [ -n "${CF_INIT_ADMIN_PASSWORD_FILE:-}" ]; then
    [ -z "${CF_INIT_ADMIN_PASSWORD:-}" ] || { echo "Use one administrator password source" >&2; exit 2; }
    [ -f "$CF_INIT_ADMIN_PASSWORD_FILE" ] && [ -r "$CF_INIT_ADMIN_PASSWORD_FILE" ] || {
      echo "Administrator password file is not readable" >&2; exit 2;
    }
    cp "$CF_INIT_ADMIN_PASSWORD_FILE" "$work/admin-password"
    admin_file="$work/admin-password"
  elif [ -n "${CF_INIT_ADMIN_PASSWORD:-}" ]; then
    printf '%s' "$CF_INIT_ADMIN_PASSWORD" > "$work/admin-password"
    admin_file="$work/admin-password"
  fi
  if [ -n "$admin_file" ]; then
    LC_ALL=C.UTF-8 grep -q '[^[:space:][:cntrl:]]' "$admin_file" || {
      echo "Administrator password must not be blank" >&2; exit 2;
    }
    status=$(curl --disable --silent --show-error --connect-timeout 5 --max-time 30 \
      --output "$work/admin-response" --write-out '%{http_code}' \
      --data-urlencode "password@$admin_file" "$server/v3/auth/user/admin") || {
        echo "Administrator initialization request failed" >&2; exit 1;
      }
    case "$status" in 2??|409) ;; *) echo "Administrator initialization failed (HTTP $status)" >&2; exit 1 ;; esac
    jq -e '(.code == 0) or (.code == 409)' "$work/admin-response" > /dev/null || {
      echo "Administrator initialization rejected" >&2; exit 1;
    }
    if [ "$username" = nacos ]; then
      export CF_AUTH_WAIT_SECONDS=60 CF_AUTH_REQUIRE_ADMIN=true
    fi
  fi
  export CF_USERNAME="$username"
  if [ -n "${CF_INIT_PASSWORD_FILE:-}" ]; then
    [ -z "${CF_INIT_PASSWORD:-}" ] || { echo "Use one import password source" >&2; exit 2; }
    export CF_PASSWORD_FILE="$CF_INIT_PASSWORD_FILE"
    unset CF_PASSWORD
  elif [ -n "${CF_INIT_PASSWORD:-}" ]; then
    export CF_PASSWORD="$CF_INIT_PASSWORD"
    unset CF_PASSWORD_FILE
  elif [ -n "$admin_file" ] && [ "$username" = nacos ] && [ -z "${CF_PASSWORD:-}${CF_PASSWORD_FILE:-}${CF_TOKEN:-}${CF_TOKEN_FILE:-}" ]; then
    export CF_PASSWORD_FILE="$admin_file"
  fi
  if [ -n "${CF_INIT_TOKEN_FILE:-}" ]; then export CF_TOKEN_FILE="$CF_INIT_TOKEN_FILE"; unset CF_TOKEN; fi
  if [ -n "${CF_INIT_TOKEN:-}" ]; then export CF_TOKEN="$CF_INIT_TOKEN"; unset CF_TOKEN_FILE; fi
  set -- "${NACOS_HOME}/bin/cf-server" config import "$file" --server "$server" --namespace "$namespace" --username "$username"
  case "$name" in
    *.[zZ][iI][pP])
      [ -z "${CF_INIT_GROUP:-}${CF_INIT_DATA_ID:-}${CF_INIT_TYPE:-}" ] || {
        echo "ZIP groups, names and types come from archive metadata" >&2; exit 2;
      } ;;
    *)
      set -- "$@" --group "$group"
      if [ -n "${CF_INIT_DATA_ID:-}" ]; then set -- "$@" --data-id "$CF_INIT_DATA_ID"; fi
      if [ -n "${CF_INIT_TYPE:-}" ]; then set -- "$@" --type "$CF_INIT_TYPE"; fi ;;
  esac
  if [ "$overwrite" = true ]; then set -- "$@" --overwrite; fi
  # Auth role caches may take time after first administrator creation; retry login reads only in CLI.
  "$@" > "$work/import-summary" &
  import_pid=$!
  if ! wait "$import_pid"; then echo "Initialization import failed; server will stop" >&2; exit 1; fi
  import_pid=''
  kill -0 "$child" 2>/dev/null || { echo "Server exited during initialization import" >&2; exit 1; }
  completion=$(mktemp "$state/.completed.XXXXXX")
  printf '%s\n' "$checksum" > "$completion"
  mv "$completion" "$state/$key.done"
  completion=''
  echo "Initialization import completed"
fi
rm -rf "$work"
work=''
printf '%s\n' ready > /tmp/cf-server-import-ready
wait "$child"
