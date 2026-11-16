# Arco Console

基于 React、Arco Design 和 Arco Design Pro 官方主题的独立 Nacos 3.3.0 管理界面。
使用现有 Console/Auth API，前端构建不修改或重新打包 Java 服务。

## 本地启动

需要 Node.js 20.19+ 或 22.12+。

```bash
cd console-ui-arco
npm ci
cp .env.example .env.local
# 在 .env.local 中填写现有 Console 和认证服务地址
npm run dev
```

访问 http://127.0.0.1:5174 。使用现有 Nacos 用户名、密码登录；也可以点击「体验演示」。
直接预览：http://127.0.0.1:5174/?preview=demo#/overview ，无需经过登录页。
此链接仅在 `enableDemo=true` 时启用；不会覆盖已有的真实账号登录信息，退出演示后恢复原会话。
演示数据只存在于浏览器内存中，刷新后重置，不会调用真实后端。
两个 UI 使用不同的浏览器存储键，互不覆盖登录信息。
命名空间选择按账号和真实/演示模式分别记忆。

## 当前功能

- 工作台：当前空间的配置数、服务数与集群节点，以及配置/服务概览。
- 配置列表：按 Data ID / Group 查询、分页、新建、编辑、确认发布与删除。
- 配置历史内容查看、按配置或 IP 查询监听关系。
- 服务列表、集群/实例详情、实例上线/下线确认、订阅者查询。
- 命名空间查询、新建、修改、空空间删除与切换。
- 管理员集群节点查询，用户/角色/权限只读查询。
- MCP、Agent、Prompt、Skill、AgentSpec 管理，以及平台级 Copilot 配置，详见下表。
- Arco 官方浅色/深色主题、可折叠菜单、窄屏布局。

配置回滚、配置导入导出、灰度发布、Naming 服务创建/删除、权限写入和 OIDC 单点登录
尚未迁移。后端继续校验每个实际请求的权限。

### AI 页面

AI 页面直接使用现有 Console API，采用 Arco 官方组件和本地 Monaco 编辑器。

| 页面 | 已实现内容 |
| --- | --- |
| MCP 服务 | 分页查询、资源与精确版本详情、草稿创建/编辑/删除、工具 Schema、资源定义、连接及客户端配置查看。 |
| Agent 管理 | 资源信息、多协议调用定义、声明地址与运行时注册地址查看、版本及草稿管理。运行时地址只读，不替代客户端注册。 |
| Prompt 管理 | 分页查询、模板与变量定义、草稿及版本管理、自定义版本标签、描述与业务标签、版本 Markdown 下载。 |
| Skill 管理 | 分页查询、SKILL.md 与完整资源文件编辑、版本治理、可见范围与标签、单 Skill ZIP 预检/上传、版本 ZIP 下载。 |
| AgentSpec 管理 | 分页查询、manifest.json 与完整资源文件编辑、草稿及版本治理、可见范围与标签、ZIP 上传。 |
| Copilot 设置 | 平台级 DashScope API Key、Qwen 模型名称与 AgentScope Studio 配置；保留未修改的高级字段。 |

版本操作包括提交审核、刷新审核结果、发布、退回草稿和版本上下线；资源启停、可见范围、
标签及删除按对应 API 能力提供。未配置适用流水线时，提交可能直接上线。
普通发布入口要求版本为 `reviewed` 且当前审核结果为 `APPROVED`；强制发布入口只向全局管理员
提供，且要求资源可写、版本为 `reviewing/reviewed`、当前结果为 `REJECTED`。
`historical=true` 的旧审核结果不授权发布；`reviewing` 遗留当前终态结果时，可重新提交以恢复审核流程。
`latest` 标签由服务端维护，前端仅编辑自定义标签。

入口遵循服务端状态：AI 资源要求 `ai_enabled=true`，且 `function_mode` 未设置或为 `ai`；
Copilot 设置要求 `copilot_enabled=true` 和全局管理员身份。直接访问路由同样检查这些条件。
部署配置对应 `nacos.extension.ai.enabled` 和 `nacos.copilot.enabled`，最终可用性仍由服务端决定。
资源按 Namespace ID 隔离；打开编辑或确认操作时保留空间、资源与精确版本身份。
编辑期间锁定命名空间，关闭未保存的编辑需要确认。`writable=false` 的资源不提供写操作；
可见性、权限与生命周期冲突仍由后端校验。

Skill ZIP 上传只支持一个有效 Skill，先预检后确认；覆盖已有草稿需要明确确认，未知或阻断的
预检结果不允许上传。AgentSpec 编辑会整体替换 manifest 与资源映射，应保留仍需使用的所有文件。
AgentSpec 新建先创建空草稿再保存内容；第二步失败时保留草稿供继续编辑，不代表保存完成。

Copilot 配置不随命名空间切换。读取界面遮蔽 API Key，清空已有密钥需要确认；保存通过 JSON
请求正文传输，前端不将密钥写入 URL、浏览器持久存储或日志。该页只配置现有 DashScope/Qwen 能力，
不提供聊天、推理、自动测试调用或额外 provider/base URL 设置。

AI 演示模式使用独立内存数据，支持示例资源和版本操作，不连接真实后端、不执行包内代码或模型调用。
演示模式不支持 ZIP 上传；示例运行时地址不证明真实服务在线。

## 运行时配置

编辑 `public/runtime-config.js`，构建后对应 `dist/runtime-config.js`，无需重建即可修改：

- `name`：平台名称。
- `apiBase`：同源代理前缀，默认 `/platform-api/`。静态页面路径与 API 路径独立。
- `enableDemo`：显示演示入口。正式部署可设为 `false`。
- `storagePrefix`：浏览器会话、账号命名空间与主题的存储键前缀，默认 `platform.console`。
- `legacyStoragePrefix`：可选的临时迁移来源前缀。升级时按需读取旧会话和偏好，写入新前缀后删除对应旧键；新键始终优先。

从旧 Arco 版本升级时，可临时设置 `legacyStoragePrefix: 'nacos.arco'`，保留已有浏览器登录、
账号空间与主题选择。旧前缀仅存在于运维显式提供的运行时配置，未内置到前端脚本。
迁移窗口结束后移除此配置，避免继续公开旧前缀；尚未访问完成迁移的浏览器需要重新登录一次。
未设置迁移来源时直接使用新前缀，已有浏览器需重新登录，SDK 凭据和客户端连接不受影响。
更换 `storagePrefix` 同样需要按需指定旧前缀；不同前缀的控制台会话互相隔离。

匿名状态、旧 UI/静态资源、公开 NOTICE 和通用错误详情的可选控制，以及部署时的端口来源限制，
见 [Console 暴露控制](../docs/console-exposure-hardening.md)。这些设置需在部署时明确选择。

配置文件只存放公开展示信息和代理路径。不要填写密码、token、服务端 identity 或签名密钥。
此版支持 Nacos 默认用户名/密码认证及其 LDAP 适配，保持登录接口和 token 协议。
现有服务器的 `nacos.console.ui.enabled` 保持开启。

## 构建与验证

```bash
npm run lint
npm test
npm run build
```

如环境已安装 Python Playwright 与 Chromium，可运行浏览器回归：

```bash
python3 e2e/smoke.py --base-url http://127.0.0.1:5174
python3 e2e/ai-smoke.py --base-url http://127.0.0.1:5174
```

该脚本在独立浏览器上下文中操作演示数据，真实登录失败/权限不足/token 过期使用模拟响应。
不会修改真实 Nacos 数据。
AI 回归还覆盖五类资源的创建、编辑和版本流转、下载、空间隔离、Copilot 密钥展示与功能开关。

`dist/` 是完整静态产物，包含本地 Monaco 编辑器及 worker，无 CDN 依赖。
HTML、运行时配置应禁用长缓存；带 hash 的资源可设置长期缓存。
Hash Router 支持把同一构建产物放在任意静态子目录。

## Nginx 示例

把 `dist/` 放到 `/opt/console-arco/` 后，可在已有站点添加：

```nginx
location /platform/ {
    alias /opt/console-arco/;
    add_header Cache-Control "no-cache";
}
location /platform-api/v3/console/ {
    proxy_pass http://127.0.0.1:18090/control/v3/console/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /platform-api/v3/auth/ {
    proxy_pass http://127.0.0.1:8848/nacos/v3/auth/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

浏览器访问 `/platform/`；网关会继续转发 `Authorization` 和 `accessToken` 请求头。
前端部署、切换或回退只涉及静态文件和 Nginx，无需重启 Nacos。SDK 的 8848/9848 接入保持原配置。

## 与服务端整合打包

整合模式将 Arco 静态资源放入现有 `next` 入口，使用同一 Console 的认证与管理接口。
从仓库根目录构建服务端后，再构建并打包前端：

```bash
mvn -B '-Prelease-nacos,!dev' -Dmaven.test.skip=true clean install
cd console-ui-arco
npm ci
npm run build
python3 scripts/integrate.py \
  --server-jar ../bootstrap/target/nacos-server.jar \
  --output /tmp/nacos-server-arco.jar \
  --context-path /control
python3 -m unittest discover -s tests -p 'test_*.py'
```

`--context-path` 必须与服务器 `nacos.console.contextPath` 一致。整合产物会将 API 前缀设为
该 context path，并关闭演示入口。默认附带通用 favicon，可用 `--favicon` 指定自己的 SVG。
脚本生成新的 JAR，不覆盖输入或已存在的输出；保留 Java 类、其他模块和 Legacy 页面，
并检查嵌套 JAR 的存储格式及资源 CRC。它不读取服务器密码、签名密钥或业务数据。
浏览器存储前缀可用 `--storage-prefix` 指定；升级迁移需显式传入 `--legacy-storage-prefix`。
默认整合产物使用中性前缀，不包含迁移来源配置。

发布时先备份现有 JAR、plugins、conf 和停机后的 data，再替换已验证的二进制产物。
保留已有配置、数据目录和客户端端口；重启后分别等待 Server API、Console 和业务注册就绪。
同版本代码回退优先恢复原 JAR/plugins，避免将运行中的业务数据回退到旧快照。

已执行的功能与故障验证范围见 [验证记录](docs/validation.md)。

设计约束见 [DESIGN.md](DESIGN.md)，上游来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
