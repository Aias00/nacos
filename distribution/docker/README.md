<!--
Copyright 1999-2026 Alibaba Group Holding Ltd.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
-->

# CF Server 统一数据库镜像

`harbor.dap.local/middleware/cf-server` 包含 Derby、MySQL、PostgreSQL、达梦的数据源插件和
JDBC 驱动。相同标签通过 manifest list 支持 `linux/amd64` 和 `linux/arm64`。
默认单机 Derby；外部数据库使用 `DB_TYPE` 选择，不再需要专用达梦镜像。

## 启动配置

| 环境变量 | 默认/含义 |
| --- | --- |
| `DB_TYPE` | `derby`；可选 `mysql`、`postgresql`、`dm` |
| `DB_URL` | 外部数据库完整 JDBC URL，必须与类型一致 |
| `DB_USER` / `DB_PASSWORD` | 独立应用数据库账号，外部数据库必填 |
| `DB_INIT_ENABLED` | `true`：启动前自动初始化；`false`：由 DBA 预先初始化 |
| `DB_SCHEMA` | 可选，断言 JDBC 当前 Schema，不自动切换或创建 Schema |
| `DB_INIT_LOCK_TIMEOUT` | `60` 秒，等待其他实例完成初始化的上限 |
| `MODE` | `standalone`；集群使用 `cluster` |
| `DEPLOYMENT` | `merged`；也支持 `server`、`console` |
| `JAVA_OPTS` | 默认 `-Xms256m -Xmx512m -XX:MaxDirectMemorySize=128m` |

例如 MySQL：

```sh
docker run -d --name cf-server --restart unless-stopped \
  -p 8080:8080 -p 8848:8848 -p 9848:9848 \
  --env-file /secure/cf-server.env \
  -v cf-server-data:/opt/nacos/data -v cf-server-logs:/opt/nacos/logs \
  harbor.dap.local/middleware/cf-server:<version>
```

私有 env 文件内容示例（不要提交实际密码）：

```text
DB_TYPE=mysql
DB_URL=jdbc:mysql://mysql-host:3306/cf_server?characterEncoding=utf8&serverTimezone=UTC
DB_USER=cf_server
DB_PASSWORD=<数据库密码>
DB_INIT_ENABLED=true
NACOS_AUTH_IDENTITY_KEY=<集群内一致的身份键>
NACOS_AUTH_IDENTITY_VALUE=<集群内一致的随机身份值>
NACOS_AUTH_TOKEN=<至少32字节随机内容的Base64编码>
```

切换 PostgreSQL：`DB_TYPE=postgresql`、`DB_URL=jdbc:postgresql://host:5432/cf_server`；
切换达梦：`DB_TYPE=dm`、`DB_URL=jdbc:dm://host:5236`，并使用对应专用用户。
PostgreSQL 非默认 Schema 应通过 JDBC `currentSchema` 选择，`DB_SCHEMA` 只校验所选 Schema。
数据库选择和连接参数统一来自 `DB_*`；禁止通过容器启动参数覆盖数据源或 Spring 配置文件来源，
避免初始化器与服务连接不同数据库。旧达梦镜像的 `DM_URL/DM_USER/DM_PASSWORD` 需改为 `DB_*`。

## 自动建表边界

- 数据库、用户和 Schema 必须已存在；账号需要在目标 Schema 内建表、建索引及加约束的权限。
- 启动前按数据库选择随包 SQL，创建缺失表/索引/约束，已有结构通过兼容校验后保留。
- 不执行 `DROP`、`TRUNCATE` 或业务数据初始化，不重置账号，不自动迁移不兼容表结构。
- PostgreSQL 原始 SQL 含历史 `DROP TABLE`，构建时移除这些语句；初始化器同时拒绝破坏性语句。
- 通过数据库级锁串行化并发初始化；达梦用独立连接持有锁，避免 DDL 隐式提交释放锁。
- 权限不足、SQL 错误、结构不兼容或超时均终止启动，不吞掉异常继续提供服务。
- Derby 保持其已有内置初始化流程；独立 Console 模式不建业务表。
- 首次创建的是业务表，不预置管理员密码；服务启动后通过管理员初始化接口设置。

容器以 UID/GID10001 运行，数据和日志挂卷需可写。挂载配置文件时不要用空目录覆盖整个
`/opt/nacos/conf`，否则会隐藏随包 SQL、数据源配置及日志配置。

## 构建

先构建 release、DM 插件和 Arco；整合前端使用容器根 context：

```sh
mvn -B '-Prelease-nacos,!dev' -Dmaven.test.skip=true clean install
npm --prefix console-ui-arco ci
npm --prefix console-ui-arco run build
python3 console-ui-arco/scripts/integrate.py \
  --server-jar bootstrap/target/nacos-server.jar --context-path '' \
  --output /tmp/cf-server.jar
mvn dependency:get -Dartifact=com.dameng:DmJdbcDriver8:8.1.5.45
python3 distribution/docker/prepare-context.py \
  --server-jar /tmp/cf-server.jar \
  --release-dir distribution/target/nacos-server-3.3.0/nacos \
  --output /tmp/cf-unified-context \
  --dm-plugin plugin-default-impl/nacos-default-datasource-plugin/nacos-datasource-plugin-dm/target/nacos-datasource-plugin-dm-3.3.0.jar \
  --dm-driver "$HOME/.m2/repository/com/dameng/DmJdbcDriver8/8.1.5.45/DmJdbcDriver8-8.1.5.45.jar"
```

上下文工具需要 JDK17 的 `javac/jar`，将纯 JDBC 初始化器编译为独立 JAR；运行镜像只需要 JRE。
镜像不写入数据库、Harbor 或管理员密码，运行时通过 Secret/私有 env 文件提供。

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg BASE_IMAGE=eclipse-temurin:17-jre-jammy \
  --build-arg SOURCE_REVISION=<源码提交> --build-arg VARIANT=unified \
  -t harbor.dap.local/middleware/cf-server:<version> --push /tmp/cf-unified-context
```

构建机不能访问 Harbor 时，分别导出架构镜像到已登录 Harbor 的中转机推送，再创建多架构索引。
发布前验证空库建表、重复启动数据保留、缺失对象恢复、并发启动锁、权限/结构错误拒绝启动，
以及三种外部数据库上的 Nacos 配置 CRUD、历史、分页、认证和 Arco 登录。

## 初始化器回归测试

`sh distribution/docker/tests/run-tests.sh` 编译并运行纯 JDK SQL 解析/结构校验测试。
真实 JDBC 测试需另建一次性空 Schema，设置 `CF_SCHEMA_TEST_DISPOSABLE=true`、
`CF_SCHEMA_TEST_JDBC_DRIVER`、`DB_TYPE/DB_URL/DB_USER/DB_PASSWORD/NACOS_HOME` 后运行同一脚本；
该测试会主动制造不兼容结构，只能用于明确可丢弃的测试 Schema，禁止连接业务库。
`python3 distribution/docker/verify-entrypoint.py --image <候选镜像>` 验证数据源覆盖冲突在连接前被拒绝。
