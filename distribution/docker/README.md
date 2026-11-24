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

部署、初始化和导入的完整操作步骤见 [CF Server 使用手册](../../docs/CF_SERVER_USAGE.md)。

`harbor.dap.local/middleware/cf-server` 包含 Derby、MySQL、PostgreSQL、达梦的数据源插件和
JDBC 驱动。相同标签通过 manifest list 支持 `linux/amd64` 和 `linux/arm64`。
默认单机 Derby；外部数据库根据 `DB_URL` 自动选择，不再需要专用达梦镜像。

## 启动配置

| 环境变量 | 默认/含义 |
| --- | --- |
| `DB_TYPE` | 无需配置；根据 JDBC URL 自动判断。可选显式值用于兼容，必须与 URL 一致 |
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
DB_URL=jdbc:mysql://mysql-host:3306/cf_server?characterEncoding=utf8&serverTimezone=UTC
DB_USER=cf_server
DB_PASSWORD=<数据库密码>
DB_INIT_ENABLED=true
NACOS_AUTH_IDENTITY_KEY=<集群内一致的身份键>
NACOS_AUTH_IDENTITY_VALUE=<集群内一致的随机身份值>
NACOS_AUTH_TOKEN=<至少32字节随机内容的Base64编码>
```

切换 PostgreSQL：`DB_URL=jdbc:postgresql://host:5432/cf_server`；
切换达梦：`DB_URL=jdbc:dm://host:5236`，并使用对应专用用户。
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

## 配置导入命令（镜像内置）

文件先只读挂载或通过 `docker cp` 放进容器。CLI 通过有权限的用户调用 Admin API，不直连数据库：

```sh
docker exec -e CF_USERNAME=operator -e CF_PASSWORD_FILE=/run/secrets/import-password \
  cf-server cf-server config import /imports/application.yaml \
  --namespace public --group DEFAULT_GROUP

docker exec -e CF_USERNAME=operator -e CF_PASSWORD_FILE=/run/secrets/import-password \
  cf-server cf-server config import /imports/configs.zip --namespace dcup --overwrite
```

单文件必须是 UTF-8，默认文件名为 Data ID，按扩展名识别类型；可用 `--data-id`、`--type` 修改。
ZIP 必须是平台导出的配置包，包含根 `.metadata.yml`（或兼容 `.meta.yml`）和 `Group/DataID` 内容；
组、名称、类型来自包内元数据，不能再通过单文件选项覆盖。不支持任意目录压缩包。
目标 Namespace ID 必须已存在，默认 public。同名配置默认 SKIP；`--overwrite` 才覆盖。
单文件也封装成同一种 ZIP，由服务端应用冲突策略，不通过先查询再发布判断是否存在。

`--server` 或 `CF_SERVER_URL` 指定完整服务地址，默认 `http://127.0.0.1:8848/nacos`。
支持 `CF_USERNAME` + `CF_PASSWORD`/`CF_PASSWORD_FILE`，或 `CF_TOKEN`/`CF_TOKEN_FILE`。
密码文件按原始字节读取，末尾换行也是密码的一部分；文件必须对容器 UID10001 可读。
密码、令牌不接受命令行选项，不写入普通日志；成功输出只含导入/跳过数量的 JSON。
网络超时不自动重试导入写请求；HTTP 成功但业务失败、未识别条目或部分导入均返回非零退出码。
已有成功条目可能已经写入，导入不是整包回滚事务。

## 启动自动导入

通过 `CF_INIT_CONFIG_FILE` 启用；未设置时保持正常启动，不做配置导入。示例私有 env 文件：

```text
CF_INIT_CONFIG_FILE=/imports/configs.zip
CF_INIT_NAMESPACE=public
CF_INIT_USERNAME=nacos
CF_INIT_ADMIN_PASSWORD_FILE=/run/secrets/initial-admin-password
```

启动时只读挂载配置包和秘密文件：

```sh
docker run -d --name cf-server --restart unless-stopped \
  --env-file /secure/cf-server.env \
  -v ./configs.zip:/imports/configs.zip:ro \
  -v ./initial-admin-password:/run/secrets/initial-admin-password:ro \
  -v cf-server-data:/opt/nacos/data -v cf-server-logs:/opt/nacos/logs \
  -p 8080:8080 -p 8848:8848 -p 9848:9848 \
  harbor.dap.local/middleware/cf-server:3.3.0
```

上述 env 仍需包含前文的 `NACOS_AUTH_*`，使用外部数据库时还需 `DB_URL/DB_USER/DB_PASSWORD`。

| 参数 | 行为 |
| --- | --- |
| `CF_INIT_CONFIG_FILE` | 容器内可读的单文件或平台导出 ZIP |
| `CF_INIT_NAMESPACE` | 已存在的 Namespace ID，默认 public |
| `CF_INIT_GROUP` | 仅单文件，默认 DEFAULT_GROUP；ZIP 使用包内组 |
| `CF_INIT_DATA_ID` / `CF_INIT_TYPE` | 仅单文件，默认文件名/扩展名 |
| `CF_INIT_OVERWRITE` | 默认 false；true 显式覆盖同名配置 |
| `CF_INIT_USERNAME` | 默认使用 CF_USERNAME，否则 nacos |
| `CF_INIT_PASSWORD` / `CF_INIT_PASSWORD_FILE` | 已存在的导入账号密码，也可使用 CLI 的 CF_PASSWORD(_FILE) |
| `CF_INIT_TOKEN` / `CF_INIT_TOKEN_FILE` | 已有效且有权限的导入令牌 |
| `CF_INIT_ADMIN_PASSWORD` / `CF_INIT_ADMIN_PASSWORD_FILE` | 显式选择首次管理员初始化；空白值拒绝，已有管理员不重置 |
| `CF_INIT_TIMEOUT` | 等待本机服务就绪的秒数，默认120 |

新建管理员用户名为 nacos；若未另外提供导入凭据，使用同一显式初始化密码登录。
已有管理员时初始化接口返回409，不重置任何密码；此时提供的导入凭据必须仍有效。
只支持默认内置认证的管理员初始化，其他认证类型应使用预置有效账号/令牌。

流程：数据库表初始化 → 启动 Java → 等待就绪 → 认证导入 → 记录成功摘要。
摘要记录于 `/opt/nacos/data/init-import`，涵盖文件内容、名称、命名空间、单文件组/ID/类型、
覆盖策略、服务地址及数据库目标；只有导入成功后才写入。同一输入和目标重启时跳过，
文件或目标改变则重新处理。数据卷应持久化；这不是持续配置同步，手动修改后的配置不会在每次重启被还原。
导入失败或部分成功不写完成记录，并终止 Java、以非零状态退出。
容器健康检查在导入完成前保持未就绪。PID1 转发终止信号给 Java，等待其退出。
自动导入仅适用于 merged/server 模式；独立 console 模式仍提供正常健康检查，但不执行本地 Admin 导入。
端口/路径从普通 application.properties、对应环境变量、JVM/启动参数依次解析，并用同一最终值启动服务；
复杂占位符请改用显式端口/路径环境变量。
