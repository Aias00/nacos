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
ARG BASE_IMAGE=eclipse-temurin:17-jre-jammy
FROM ${BASE_IMAGE}
ARG VARIANT=unified
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="CF Server" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      cn.dap.nacos.variant="${VARIANT}"
ENV NACOS_HOME=/opt/nacos MODE=standalone DEPLOYMENT=merged \
    JAVA_OPTS="-Xms256m -Xmx512m -XX:MaxDirectMemorySize=128m"
WORKDIR /opt/nacos
COPY --chown=10001:10001 release/ /opt/nacos/
COPY --chown=10001:10001 --chmod=755 entrypoint.sh /opt/nacos/bin/container-entrypoint.sh
USER 10001:10001
EXPOSE 8848 9848 9849 7848 8080
ENTRYPOINT ["/opt/nacos/bin/container-entrypoint.sh"]
