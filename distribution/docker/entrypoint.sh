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
case "${MODE}" in
  standalone) standalone=true ;;
  cluster) standalone=false ;;
  *) echo "MODE must be standalone or cluster" >&2; exit 2 ;;
esac
case "${DEPLOYMENT}" in
  merged|server|console) ;;
  *) echo "DEPLOYMENT must be merged, server or console" >&2; exit 2 ;;
esac
DB_TYPE="${DB_TYPE:-derby}"
DB_INIT_ENABLED="${DB_INIT_ENABLED:-true}"
export DB_TYPE DB_INIT_ENABLED
case "${DB_TYPE}" in
  derby) ;;
  mysql|postgresql|dm)
    : "${DB_URL:?Set DB_URL to the selected database JDBC URL}"
    : "${DB_USER:?Set DB_USER to the dedicated database user}"
    : "${DB_PASSWORD:?Set DB_PASSWORD to its password}"
    case "${DB_TYPE}:${DB_URL}" in
      mysql:jdbc:mysql:*|postgresql:jdbc:postgresql:*|dm:jdbc:dm:*) ;;
      *) echo "DB_TYPE and JDBC URL do not match" >&2; exit 2 ;;
    esac
    ;;
  *) echo "DB_TYPE must be derby, mysql, postgresql or dm" >&2; exit 2 ;;
esac
case "${DB_INIT_ENABLED}" in
  true|false) ;;
  *) echo "DB_INIT_ENABLED must be true or false" >&2; exit 2 ;;
esac
# Reject alternate Spring/JVM connection sources rather than initializing a different database.
for name in $(env | sed 's/=.*//'); do
  case "${name}" in
    DB_TYPE|DB_URL|DB_USER|DB_PASSWORD|DB_SCHEMA|DB_INIT_ENABLED|DB_INIT_LOCK_TIMEOUT|DB_VALIDATION_QUERY) continue ;;
  esac
  key=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -d '._-')
  case "${key}" in
    springapplicationjson|springconfig*|springdatasource*|springsqlinitplatform|nacosplugindatasource*|dbpoolconfig*|dbnum|dburl*|dbuser*|dbpassword*)
      echo "Conflicting datasource environment; use DB_* variables only" >&2; exit 2 ;;
  esac
done
for option in ${JAVA_OPTS:-} ${JAVA_TOOL_OPTIONS:-} ${JDK_JAVA_OPTIONS:-} ${_JAVA_OPTIONS:-}; do
  case "${option}" in
    -Dspring.config.*|-Dspring.application.json*|-Dspring.sql.init.platform*|-Dspring.datasource*|-Dnacos.plugin.datasource*|-Ddb.*|@*)
      echo "Conflicting datasource JVM option; use DB_* variables only" >&2; exit 2 ;;
  esac
done
if ! cmp -s "${NACOS_HOME}/conf/datasource.properties" "${NACOS_HOME}/bin/datasource.properties.template"; then
  echo "Use the bundled datasource.properties with DB_* variables" >&2; exit 2
fi
for config in "${NACOS_HOME}"/conf/*.properties; do
  [ "$config" = "${NACOS_HOME}/conf/datasource.properties" ] && continue
  if ! awk '
    /^[[:space:]]*([#!]|$)/ { next }
    $0 == "spring.config.import=file:/opt/nacos/conf/datasource.properties" { next }
    { key=$0; sub(/[=:].*/, "", key); gsub(/[[:space:]_.-]/, "", key); key=tolower(key)
      if (key ~ /^(nacosplugindatasource|springdatasource|springsqlinitplatform|dburl|dbuser|dbpassword|dbnum|dbpoolconfig|springconfig|springapplicationjson)/) exit 1 }
  ' "$config"; then
    echo "Conflicting datasource file configuration; use DB_* variables only" >&2; exit 2
  fi
done
for config in "${NACOS_HOME}"/conf/application*.yaml "${NACOS_HOME}"/conf/application*.yml; do
  if [ -f "$config" ]; then
    echo "Use bundled properties and DB_* variables instead of application YAML overrides" >&2; exit 2
  fi
done
# Keep initialization and Nacos on the same datasource; do not override selection via CLI.
for option in "$@"; do
  case "${option}" in
    --spring.config.*|--spring.application.json*|--spring.sql.init.platform*|--spring.datasource*|--nacos.plugin.datasource*|--db.*)
      echo "Use DB_* environment variables for datasource configuration" >&2; exit 2 ;;
  esac
done
case "${DB_TYPE}" in
  dm) DB_VALIDATION_QUERY='SELECT 1 FROM DUAL' ;;
  derby) DB_VALIDATION_QUERY='VALUES 1' ;;
  *) DB_VALIDATION_QUERY='SELECT 1' ;;
esac
export DB_VALIDATION_QUERY
if [ "${DEPLOYMENT}" != console ] && [ "${DB_TYPE}" != derby ] && [ "${DB_INIT_ENABLED}" = true ]; then
  java -cp "${NACOS_HOME}/bin/schema-init.jar:${NACOS_HOME}/plugins/*" cn.dap.cf.SchemaInitializer
fi
# JAVA_OPTS intentionally accepts whitespace-separated JVM options, never eval.
exec java ${JAVA_OPTS} \
  --add-opens=java.base/java.lang=ALL-UNNAMED \
  --add-opens=java.base/java.lang.reflect=ALL-UNNAMED \
  --add-opens=java.base/java.util=ALL-UNNAMED \
  "-Dderby.stream.error.file=${NACOS_HOME}/logs/derby.log" \
  "-Dnacos.home=${NACOS_HOME}" "-Dloader.path=${NACOS_HOME}/plugins" \
  "-Dnacos.standalone=${standalone}" "-Dnacos.deployment.type=${DEPLOYMENT}" \
  -jar "${NACOS_HOME}/target/nacos-server.jar" \
  "--spring.config.additional-location=file:${NACOS_HOME}/conf/" \
  "--logging.config=${NACOS_HOME}/conf/nacos-logback.xml" "$@"
