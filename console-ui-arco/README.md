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
演示数据只存在于浏览器内存中，刷新后重置，不会调用真实后端。
两个 UI 使用不同的浏览器存储键，互不覆盖登录信息。
命名空间选择按账号和真实/演示模式分别记忆。

## 第一版功能

- 工作台：当前空间的配置数、服务数与集群节点，以及配置/服务概览。
- 配置列表：按 Data ID / Group 查询、分页、新建、编辑、确认发布与删除。
- 配置历史内容查看、按配置或 IP 查询监听关系。
- 服务列表、集群/实例详情、实例上线/下线确认、订阅者查询。
- 命名空间查询、新建、修改、空空间删除与切换。
- 管理员集群节点查询，用户/角色/权限只读查询。
- Arco 官方浅色/深色主题、可折叠菜单、窄屏布局。

配置回滚、导入导出、灰度发布、服务创建/删除、权限写入、OIDC 单点登录和 AI 模块
不在本次首版范围内。后端继续校验每个实际请求的权限；普通用户不会因为前端换肤获得额外权限。

## 运行时配置

编辑 `public/runtime-config.js`，构建后对应 `dist/runtime-config.js`，无需重建即可修改：

- `name`：平台名称。
- `apiBase`：同源代理前缀，默认 `/platform-api/`。静态页面路径与 API 路径独立。
- `enableDemo`：显示演示入口。正式部署可设为 `false`。

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
```

该脚本在独立浏览器上下文中操作演示数据，真实登录失败/权限不足/token 过期使用模拟响应。
不会修改真实 Nacos 数据。

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

设计约束见 [DESIGN.md](DESIGN.md)，上游来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
