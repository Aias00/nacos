<!--
Copyright 1999-2026 Alibaba Group Holding Ltd.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
-->

# Arco Nacos 容器发行

普通版沿用 Nacos 的存储选择（默认单机 Derby），不包含达梦插件/驱动；达梦版额外提供独立
`nacos-datasource-plugin-dm`、`DmJdbcDriver8` 与初始化 SQL，不修改服务端 API。
两个版本均提供 `linux/amd64` 和 `linux/arm64`，保留本分支 Arco、Legacy 禁用、声明文件 HTTP
下载禁用和 AI/Copilot 默认关闭设置。控制台默认端口 8080，路径 `/next/`；服务 HTTP 8848、
客户端 gRPC 9848，集群使用 9849/7848。不要将服务端口映射到不同偏移而遗漏 gRPC。

## 构建

先在仓库根目录构建完整 release、Arco，再整合前端；打包工具不修改输入 JAR：

```sh
mvn -B '-Prelease-nacos,!dev' -Dmaven.test.skip=true clean install
npm --prefix console-ui-arco ci
npm --prefix console-ui-arco run build
python3 console-ui-arco/scripts/integrate.py \
  --server-jar bootstrap/target/nacos-server.jar --context-path '' \
  --output /tmp/nacos-arco-server.jar
```

生成上下文（输出目录须不存在）：

```sh
python3 distribution/docker/prepare-context.py \
  --server-jar /tmp/nacos-arco-server.jar \
  --release-dir distribution/target/nacos-server-3.3.0/nacos \
  --variant standard --output /tmp/nacos-standard-context

mvn -B -pl plugin-default-impl/nacos-default-datasource-plugin/nacos-datasource-plugin-dm -am package -DskipTests
mvn dependency:get -Dartifact=com.dameng:DmJdbcDriver8:8.1.5.45
python3 distribution/docker/prepare-context.py \
  --server-jar /tmp/nacos-arco-server.jar \
  --release-dir distribution/target/nacos-server-3.3.0/nacos \
  --variant dameng --output /tmp/nacos-dameng-context \
  --dm-plugin plugin-default-impl/nacos-default-datasource-plugin/nacos-datasource-plugin-dm/target/nacos-datasource-plugin-dm-3.3.0.jar \
  --dm-driver "$HOME/.m2/repository/com/dameng/DmJdbcDriver8/8.1.5.45/DmJdbcDriver8-8.1.5.45.jar"
```

使用 Buildx 构建两种架构；`SOURCE_REVISION` 设置实际源码提交，发布时建议把基础镜像固定到已核验 digest。
普通版与达梦版分别使用对应上下文和 `VARIANT=standard` / `VARIANT=dameng`：

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg BASE_IMAGE=eclipse-temurin:17-jre-jammy \
  --build-arg SOURCE_REVISION=<commit> --build-arg VARIANT=standard \
  -t harbor.dap.local/middleware/cf-server:3.3.0 --push /tmp/nacos-standard-context
```

普通版仓库名为 `middleware/cf-server`，达梦版为 `middleware/cf-server-dameng`。
发布标签为 `3.3.0`（ARM64/AMD64 多架构），独立架构标签为 `3.3.0-arm64`、`3.3.0-amd64`。

构建环境不能访问 Harbor 时，用 `docker save` 导出各架构标签，传到已登录 Harbor 的中转机，
执行 `docker load`、`docker push`；分别提供 `-amd64` / `-arm64` 标签。多架构总标签需另外创建并
推送 manifest list，不能把单一架构镜像重复打成两种架构。

## 运行

容器以 UID/GID `10001:10001` 运行，Java 17 为前台主进程。默认单机，可通过 `MODE=cluster`
和 `DEPLOYMENT=merged|server|console` 调整；集群成员等参数使用 Nacos 标准环境变量或启动参数。
`JAVA_OPTS` 是空格分隔 JVM 参数，不支持 shell 表达式，避免在其中放密码。

认证保持开启，需通过 Secret/私有 env 文件提供：

```text
NACOS_AUTH_IDENTITY_KEY=<集群内一致的身份键>
NACOS_AUTH_IDENTITY_VALUE=<集群内一致的随机身份值>
NACOS_AUTH_TOKEN=<至少32字节随机内容的Base64编码>
```

首次启动通过 Nacos 管理员初始化接口设置管理员密码。镜像不携带预置账号密码。
数据目录 `/opt/nacos/data` 和日志目录 `/opt/nacos/logs` 应挂卷并确保 UID10001 可写。
需要自定义配置时挂载文件而非空目录覆盖整个 `/opt/nacos/conf`，避免隐藏随包日志配置和达梦配置。

达梦版还要求：

```text
DM_URL=jdbc:dm://<host>:<port>
DM_USER=<独立Nacos数据库用户>
DM_PASSWORD=<数据库密码>
```

先用专用数据库用户执行镜像内 `/opt/nacos/conf/dameng-schema.sql`；插件 JAR 也保留同一 SQL。
该 SQL 面向新 Schema，不会自动执行，也不能直接覆盖已有业务库。数据库要求和插件测试命令见
[达梦插件说明](../../plugin-default-impl/nacos-default-datasource-plugin/nacos-datasource-plugin-dm/README.md)。
通过 `--spring.config.location` 或全量外部配置覆盖启动配置时，部署者应保留对应认证与达梦参数。

## 核验

每个镜像标签执行 `docker image inspect` 检查 `Os/Architecture` 和源码标签。普通版需验证 Derby
启动、认证、配置 CRUD/分页和 Arco 入口；达梦版还需连接真实达梦库验证 CLOB、主键、分页与
历史记录。ARM64 与 AMD64 分别启动，不以标签名替代实际架构验证。推送后查询 Harbor artifact
digest，并与本地镜像 manifest 核对。数据库密码、Harbor 登录配置和测试令牌不得进入构建上下文。
