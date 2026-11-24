<!--
Copyright 1999-2026 Alibaba Group Holding Ltd.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
-->

# CF Server 部署与配置导入使用手册

本文对应已发布的配置导入版本，源码提交 `3c89ccd40`。示例采用 Linux、Bash 和 Docker CLI；
所有数据库地址、账号和密码示例均需按实际环境替换，不包含测试环境凭据。

## 1. 镜像与访问地址

| 用途 | 镜像 |
| --- | --- |
| 当前使用入口 | `harbor.dap.local/middleware/cf-server:3.3.0` |
| 固定本文版本 | `harbor.dap.local/middleware/cf-server:3.3.0-unified-3c89ccd40` |
| 仅 ARM64 | `harbor.dap.local/middleware/cf-server:3.3.0-arm64` |
| 仅 x86_64 / AMD64 | `harbor.dap.local/middleware/cf-server:3.3.0-amd64` |
| 本次更新前的回退版本 | `harbor.dap.local/middleware/cf-server:3.3.0-before-config-import` |

不带架构后缀的当前入口与固定版本均包含 `linux/arm64` 和 `linux/amd64`，Docker 自动匹配架构。
`3.3.0` 是可更新标签，生产环境需要固定版本时使用固定标签或经核验的 digest。

本文固定版本的多架构索引 digest：

```text
sha256:d519f99472096ab710a018dc6519f6319e74abf93be9a0553066b44b203df82d
```

部署机器需能访问 Harbor，并已完成登录及内部 CA 信任配置：

```bash
docker login harbor.dap.local
docker pull harbor.dap.local/middleware/cf-server:3.3.0
```

本机不能访问 Harbor 时，应在可访问的内网部署机器执行以上命令；本项目交付时使用过中转机
`172.16.21.25`。不要将 Harbor 登录配置、服务器密码提交到 Git。

| 端口/地址 | 用途 |
| --- | --- |
| `8080`，`http://服务器IP:8080/next/` | 管理控制台 |
| `8848`，默认 `/nacos` 前缀 | 服务 HTTP API、CLI Admin API 和认证 |
| `9848` | 业务客户端 gRPC |
| `9849` / `7848` | 集群节点内部通信，单机示例不发布 |

默认控制台入口仍为 `/next/`，CLI 调用的服务端上下文仍为 `/nacos`。
旧控制台、UI 声明文件下载和完整状态查询接口保持关闭；健康检查和配置管理 API 保留。

## 2. 准备认证配置

选择一个部署目录，首次生成认证配置，之后升级和重启沿用此文件：

```bash
mkdir -p cf-server-deploy
cd cf-server-deploy
umask 077
cat > cf-server.env <<EOF_ENV
MODE=standalone
DEPLOYMENT=merged
NACOS_AUTH_IDENTITY_KEY=cf-server-identity
NACOS_AUTH_IDENTITY_VALUE=$(openssl rand -hex 24)
NACOS_AUTH_TOKEN=$(openssl rand -base64 48 | tr -d '\n')
EOF_ENV
chmod 600 cf-server.env
```

上面的生成命令仅执行一次，不要每次重启重新生成。集群各节点必须使用一致的身份键、身份值和
令牌签名密钥。`NACOS_AUTH_TOKEN` 是签名密钥，不是管理员密码或登录后的 access token。

## 3. 选择数据库与自动建表

同一镜像已包含 Derby、MySQL、PostgreSQL、达梦插件和驱动。

- 不配置 `DB_URL`：使用内置 Derby，适合单机。
- 配置 `DB_URL`：根据 JDBC 前缀自动识别，无需配置 `DB_TYPE`。
- 外部数据库还必须配置 `DB_USER`、`DB_PASSWORD`。
- 可选兼容变量 `DB_TYPE` 如果填写，必须与 URL 一致；未知 URL 会报错，不会回退 Derby。

在 `cf-server.env` 追加以下三组选项中的一组。

### 3.1 MySQL

```dotenv
DB_URL=jdbc:mysql://mysql-host:3306/cf_server?characterEncoding=utf8&serverTimezone=UTC
DB_USER=cf_server
DB_PASSWORD=REPLACE_WITH_DATABASE_PASSWORD
```

### 3.2 PostgreSQL

```dotenv
DB_URL=jdbc:postgresql://postgres-host:5432/cf_server
DB_USER=cf_server
DB_PASSWORD=REPLACE_WITH_DATABASE_PASSWORD
```

非默认 Schema 使用 JDBC URL 选择，例如：

```dotenv
DB_URL=jdbc:postgresql://postgres-host:5432/cf_server?currentSchema=cf_schema
DB_SCHEMA=cf_schema
```

`DB_SCHEMA` 只校验当前连接选中的 Schema，不创建或切换 Schema。

### 3.3 达梦

```dotenv
DB_URL=jdbc:dm://dameng-host:5236
DB_USER=CF_SERVER
DB_PASSWORD=REPLACE_WITH_DATABASE_PASSWORD
```

本分支达梦适配按 DM8 原生模式 `COMPATIBLE_MODE=0`、大小写敏感数据库验证；实际验证版本为
DM 8.1.4.6。使用独立应用用户和其 Schema，不建议用 SYSDBA 运行服务。

### 3.4 自动建表规则

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `DB_INIT_ENABLED` | `true` | 外部数据库启动前自动补齐所需对象；false 时由 DBA 预先初始化 |
| `DB_INIT_LOCK_TIMEOUT` | `60` | 并发初始化锁等待秒数 |

数据库、用户和 Schema 必须先存在，应用账号需有目标 Schema 的建表、建索引及加约束权限。
初始化器仅创建缺失表、索引和约束，验证已有结构；重复启动保留已有数据。
不自动建库、建用户、删表、清数据或迁移不兼容旧结构。权限不足、结构不兼容或锁超时会终止启动。
Derby 使用原有内置初始化流程，独立 Console 模式不初始化业务表。

成功日志示例：

```text
Schema initialization complete: mysql, 16 tables verified, ... objects created
```

数据库参数统一使用 `DB_*`，不要同时通过 `JAVA_OPTS`、`SPRING_APPLICATION_JSON` 或挂载配置
覆盖数据源；检测到冲突时镜像会拒绝启动，防止初始化和服务连接不同数据库。
旧达梦镜像的 `DM_URL/DM_USER/DM_PASSWORD` 应改为统一的 `DB_*`。

## 4. 普通启动，不自动导入

```bash
docker run -d \
  --name cf-server \
  --restart unless-stopped \
  --env-file ./cf-server.env \
  -p 8080:8080 -p 8848:8848 -p 9848:9848 \
  -v cf-server-data:/opt/nacos/data \
  -v cf-server-logs:/opt/nacos/logs \
  harbor.dap.local/middleware/cf-server:3.3.0
```

```bash
docker logs -f cf-server
docker inspect --format '{{.State.Health.Status}}' cf-server
```

数据与日志应持久化。容器使用 UID/GID `10001:10001`；使用宿主机目录代替命名卷时，需确保该
用户可写。不要用空目录覆盖整个 `/opt/nacos/conf`，否则会隐藏数据源配置、SQL 和日志配置。

默认内存参数为 `-Xms256m -Xmx512m -XX:MaxDirectMemorySize=128m`，可通过 `JAVA_OPTS` 调整。
容器实际内存还包括堆外、线程和 JVM 开销，不能仅按 Xmx 设置容器内存上限。

### 4.1 首次手动初始化管理员

未启用启动自动导入时，空库不会预置管理员密码。以下命令创建一个不带末尾换行的私有密码文件：

```bash
umask 077
read -r -s -p '请输入首次管理员密码：' CF_ADMIN_PASSWORD
printf '\n'
printf '%s' "$CF_ADMIN_PASSWORD" > .admin-password
unset CF_ADMIN_PASSWORD
chmod 600 .admin-password

curl -fsS -X POST http://127.0.0.1:8080/v3/auth/user/admin \
  --data-urlencode 'password@.admin-password' > .admin-init-response.json
jq -e '.code == 0' .admin-init-response.json >/dev/null
rm -f .admin-init-response.json
```

成功后通过控制台登录，账号为 `nacos`。接口返回可能包含密码，因此不要直接把返回体记录到日志。
已有管理员时该接口返回业务码409，不用于重置密码；不要用空密码调用它。

## 5. 镜像内置 CLI 手动导入

第一期命令为 `cf-server config import`，不包含 list/publish/delete 等独立子命令。
CLI 使用有导入权限的用户或令牌调用现有 Admin API，不直接操作数据库。

### 5.1 放入配置文件和登录密码

以下方式通过 stdin 写入容器，避免宿主机文件权限与容器 UID 不一致：

```bash
docker exec -i cf-server sh -c 'umask 077; cat > /tmp/import-password' < .admin-password
docker exec -i cf-server sh -c 'umask 077; cat > /tmp/application.yaml' < ./application.yaml
```

### 5.2 导入单文件

```bash
docker exec \
  -e CF_USERNAME=nacos -e CF_PASSWORD_FILE=/tmp/import-password \
  cf-server cf-server config import /tmp/application.yaml \
  --namespace public --group DEFAULT_GROUP
```

默认文件名为 Data ID，类型按扩展名识别；可显式指定：

```bash
docker exec \
  -e CF_USERNAME=nacos -e CF_PASSWORD_FILE=/tmp/import-password \
  cf-server cf-server config import /tmp/application.yaml \
  --namespace public --group DEFAULT_GROUP \
  --data-id service.yaml --type yaml --overwrite
```

单文件必须是有效 UTF-8。支持 yaml/yml、properties、json、xml、html、toml、text；未知扩展名
默认 text。Group 和 Data ID 不接受路径分隔符或控制字符。

### 5.3 导入平台导出的 ZIP

```bash
docker exec -i cf-server sh -c 'umask 077; cat > /tmp/configs.zip' < ./configs.zip
docker exec \
  -e CF_USERNAME=nacos -e CF_PASSWORD_FILE=/tmp/import-password \
  cf-server cf-server config import /tmp/configs.zip --namespace public
```

使用平台导出的 ZIP，不是随意压缩的目录。压缩包包含根 `.metadata.yml`（或兼容 `.meta.yml`）
及 `Group/DataID` 内容；组、名称和类型沿用包内元数据，不能再传 `--group/--data-id/--type`。
包内配置内容也应为 UTF-8。目标 Namespace ID 必须已存在；ZIP 不自动创建命名空间。

同名默认跳过，加 `--overwrite` 才覆盖。单文件和 ZIP 都由服务端导入接口执行这个策略。
成功输出只含计数，例如：

```json
{"success":true,"imported":1,"skipped":0,"total":1,"policy":"SKIP"}
```

### 5.4 CLI 参数和退出码

| 参数/环境变量 | 说明 |
| --- | --- |
| `--namespace` | 已存在的 Namespace ID，默认 public |
| `--group` | 单文件组，默认 DEFAULT_GROUP |
| `--data-id` / `--type` | 单文件名称和类型覆盖 |
| `--overwrite` | 覆盖同名配置；默认 SKIP |
| `--server` / `CF_SERVER_URL` | 完整服务地址，默认 `http://127.0.0.1:8848/nacos` |
| `--username` / `CF_USERNAME` | 登录用户名 |
| `CF_PASSWORD` / `CF_PASSWORD_FILE` | 登录密码，推荐私有文件 |
| `CF_TOKEN` / `CF_TOKEN_FILE` | 已有效的访问令牌，替代密码登录 |
| `CF_CONNECT_TIMEOUT` / `CF_REQUEST_TIMEOUT` | 连接/单次请求超时，默认5/60秒 |
| `--help` | 查看镜像内命令帮助 |

密码和令牌不接受 CLI 参数，不把它们放进命令行。密码文件按原始字节读取，末尾换行也是密码的
一部分，建议使用 `printf '%s'` 创建。密码文件须对容器 UID10001 可读。

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功，含全部跳过 |
| 2 | 参数、文件、ZIP 或编码不合法 |
| 3 | 认证失败或所需身份不可用 |
| 4 | HTTP/服务端业务拒绝导入 |
| 5 | 部分导入、未识别条目或结果计数不一致 |
| 6 | 网络失败/超时，写入可能已生效，未自动重试 |

导入不是整包回滚事务；失败前成功的条目可能已提交。不要把非零返回当作“完全没有写入”。
操作完成后可删除容器中的临时密码文件：

```bash
docker exec cf-server rm -f /tmp/import-password
```

## 6. 启动时自动导入

这是普通启动的另一种方式；已有同名容器先按第8节停止和重建，保留原数据卷。

### 6.1 准备只读挂载文件（Linux）

仅执行4.1节读取密码和生成 `.admin-password` 的步骤，无需先调用初始化接口；已有管理员则使用其实际密码。准备平台导出的 `configs.zip`：

```bash
mkdir -p imports secrets
sudo install -m 0400 -o 10001 -g 10001 ./configs.zip ./imports/configs.zip
sudo install -m 0400 -o 10001 -g 10001 ./.admin-password ./secrets/admin-password
```

这一步仅准备文件，不要求提前启动服务或调用管理员初始化接口。密码文件必须可被容器 UID10001
读取。非 Linux 环境可使用容器平台的 Secret，并设置适当的读取权限。

在原 `cf-server.env` 追加：

```dotenv
CF_INIT_CONFIG_FILE=/imports/configs.zip
CF_INIT_NAMESPACE=public
CF_INIT_USERNAME=nacos
CF_INIT_ADMIN_PASSWORD_FILE=/run/secrets/admin-password
```

然后启动：

```bash
docker run -d \
  --name cf-server \
  --restart unless-stopped \
  --env-file ./cf-server.env \
  --mount type=bind,src="$(pwd)/imports/configs.zip",dst=/imports/configs.zip,readonly \
  --mount type=bind,src="$(pwd)/secrets/admin-password",dst=/run/secrets/admin-password,readonly \
  -v cf-server-data:/opt/nacos/data -v cf-server-logs:/opt/nacos/logs \
  -p 8080:8080 -p 8848:8848 -p 9848:9848 \
  harbor.dap.local/middleware/cf-server:3.3.0
```

空库首次启动会用显式密码创建管理员，再用同一密码导入；已有管理员时不重置密码，所提供的密码
必须仍有效。空白/控制字符组成的初始化密码会被拒绝。不要删除数据卷来尝试解决登录问题。

### 6.2 已有导入账号

已有账号时不需要管理员初始化参数，使用：

```dotenv
CF_INIT_CONFIG_FILE=/imports/configs.zip
CF_INIT_NAMESPACE=public
CF_INIT_USERNAME=import-operator
CF_INIT_PASSWORD_FILE=/run/secrets/import-password
```

把相应密码文件只读挂载到 `/run/secrets/import-password`，并移除不需要的
`CF_INIT_ADMIN_PASSWORD(_FILE)`。也可以提供 `CF_INIT_TOKEN_FILE`。

### 6.3 启动导入单文件

将文件挂载至 `/imports/application.yaml`，参数改为：

```dotenv
CF_INIT_CONFIG_FILE=/imports/application.yaml
CF_INIT_NAMESPACE=public
CF_INIT_GROUP=DEFAULT_GROUP
CF_INIT_DATA_ID=application.yaml
CF_INIT_OVERWRITE=false
```

认证参数按6.1或6.2节提供。Data ID 默认文件名，类型默认按扩展名识别，可用 `CF_INIT_TYPE` 指定。
ZIP 不允许设置 `CF_INIT_GROUP/CF_INIT_DATA_ID/CF_INIT_TYPE`，因为这些值来自包内元数据。

### 6.4 启动流程和重复执行

```text
自动补齐数据库表结构 → 启动服务 → 等待本机就绪 → 认证导入 → 写成功摘要 → 容器健康
```

| 参数 | 默认/用途 |
| --- | --- |
| `CF_INIT_CONFIG_FILE` | 未设置则不自动导入；设置为容器内可读文件路径时启用 |
| `CF_INIT_NAMESPACE` | public，其他 Namespace ID 必须先存在 |
| `CF_INIT_GROUP` | 单文件 DEFAULT_GROUP |
| `CF_INIT_DATA_ID` / `CF_INIT_TYPE` | 单文件默认名称/类型覆盖 |
| `CF_INIT_OVERWRITE` | false；true 显式覆盖同名配置 |
| `CF_INIT_USERNAME` | CF_USERNAME，否则 nacos |
| `CF_INIT_PASSWORD(_FILE)` | 已有导入账号密码 |
| `CF_INIT_TOKEN(_FILE)` | 已有效导入令牌 |
| `CF_INIT_ADMIN_PASSWORD(_FILE)` | 显式首次管理员初始化，不重置已有管理员 |
| `CF_INIT_TIMEOUT` | 本机服务就绪等待秒数，默认120 |

完成摘要保存在数据卷 `/opt/nacos/data/init-import`。相同文件内容、名称、目标命名空间、组/ID/类型、
覆盖策略、服务地址和数据库目标，重启时跳过；文件或目标变化会重新处理。
重新处理仍遵守默认 SKIP，只有显式覆盖才会更新同名内容。这不是持续配置同步，重启不会无条件
还原用户手动修改的配置。需要主动重导时，可运行 CLI；重建外部数据库后不要盲目信任旧数据卷里的完成记录。

只有完整成功才写摘要。认证失败、错误 ZIP、超时或部分导入会终止 Java，并以非零状态退出。
容器健康检查在导入完成前不会就绪。自动导入支持 merged/server；独立 console 模式会拒绝自动导入。

## 7. 排查与验证

```bash
docker logs --tail 100 cf-server
docker inspect --format '{{.State.Health.Status}}' cf-server
docker exec cf-server /opt/nacos/bin/healthcheck.sh
docker exec cf-server cf-server --help
```

成功日志：

```text
Initialization import completed
```

重启跳过日志：

```text
Initialization import: unchanged file and target already completed
```

| 现象 | 检查点 |
| --- | --- |
| 数据库初始化拒绝 | URL、账号权限、已有表结构、Schema 和锁等待；不会自动删除旧表 |
| `DB_TYPE and JDBC URL do not match` | 删除多余的 DB_TYPE，或修正与 URL 不一致的值 |
| 找不到导入文件 | CF_INIT_CONFIG_FILE 是容器内路径；确认只读挂载、文件存在且可读 |
| 密码文件不可读 | 检查 UID10001 权限；不要仅在宿主机上 chmod600 后假设容器可读 |
| 认证失败 | 账号密码/令牌有效性、密码文件末尾换行、账号导入权限；已有密码不会被自动重置 |
| 命名空间不存在 | 使用 Namespace ID，提前创建非 public 空间 |
| ZIP 格式不合法 | 使用平台原样导出的 ZIP，不要增加外层目录或混入其他文件 |
| 部分成功 | 查看 CLI 非零退出码；已有成功项可能存在，修复后按策略重导 |
| 修改源文件后未覆盖 | 默认 SKIP；确认是否确实需要 CF_INIT_OVERWRITE=true |
| 健康状态一直 starting | 导入尚未结束；检查日志、认证等待和服务就绪超时 |
| 一直重启 | restart策略在重复启动失败进程；先查看首个失败原因，不要删数据卷 |

可通过控制台确认目标空间、配置数量和内容；涉及敏感配置时不要将详情输出到公共日志。

## 8. 升级与回退

同名标签更新不会自动替换运行中的容器。先备份数据库和必要数据卷，保留原 env、挂载和端口参数：

```bash
docker pull harbor.dap.local/middleware/cf-server:3.3.0
docker stop cf-server
docker rm cf-server
# 按原部署命令重建，沿用原 cf-server.env 和数据卷；不要添加 -v 删除卷。
```

重建时补回第4或第6节的完整参数。不要重新生成认证签名密钥，不要使用 `docker volume rm` 清数据。
回退镜像为 `harbor.dap.local/middleware/cf-server:3.3.0-before-config-import`；按同样流程重建。
回退二进制不会撤销已经导入的配置或回滚数据库，旧版也不提供本次新增的导入命令和启动导入。

## 9. 验证范围与进一步阅读

本次功能已验证：16项 CLI 模拟接口测试、ARM64/AMD64 启动导入、首次管理员初始化、重复启动
跳过与数据保留、输入变化后的显式覆盖、无效 ZIP/空白密码拒绝、停止信号，以及真实
MySQL/PostgreSQL/达梦上的 ZIP 导入、长中文配置、自定义端口/路径和手动跳过/覆盖。
这不是全仓库测试或所有数据库版本的兼容性声明。

- [镜像构建与开发说明](../distribution/docker/README.md)
- [达梦插件说明](../plugin-default-impl/nacos-default-datasource-plugin/nacos-datasource-plugin-dm/README.md)
