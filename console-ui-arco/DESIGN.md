# Arco Console 设计约束

基于 Arco Design Pro 官方后台结构与官方 `react-arco-pro` 主题，使用 Arco 的
Layout、Menu、Breadcrumb、Card、Table、Form、Modal、Drawer、Tabs、Tag、Message 和 Result。
不另外设计组件、字体、阴影、图标或主题。页面只增加业务布局所需的尺寸与间距。

采用独立前端工程和 Hash Router，通过同源 `/platform-api/` 代理复用 Nacos 3.3.0 的
Console/Auth API。服务端、业务 SDK、登录协议和数据模型不变。

当前范围：登录、概览、命名空间、配置查询/新增/编辑/删除/历史、监听查询、服务列表与
实例详情、订阅者查询、集群节点、用户/角色/权限只读查询，以及 MCP、Agent、Prompt、Skill、
AgentSpec 管理和 Copilot 配置。
配置与 AI 内容编辑器使用本地打包的 Monaco，AI 状态展示复用共享 Tag 组件。
AI 页面沿用官方 Card/Table/Form/Drawer/Modal/Tabs/Collapse，不增加自定义视觉系统。

控制台启动只加载命名空间，不依赖公开状态、guide 或 announcement 接口。身份与管理员标志来自
登录响应，业务权限继续由后端校验。
AI/Copilot 页面实现保留，真实与演示模式默认关闭；本地运行时 `enableAi`、`enableCopilot` 仅接受
布尔值 `true` 开放菜单和直接路由，Copilot 仍要求全局管理员。这些开关只控制界面展示，部署者重新
开放前必须确认后端能力与配置一致。资源写操作遵守 `writable`，后端继续鉴权。
命名空间用 ID 隔离，编辑与确认操作保留打开时的资源身份；编辑时锁定空间，关闭未保存内容需要确认。
审核结果以当前非历史 Pipeline 为准，`reviewed` 不等于审核通过；只有当前 `APPROVED` 可普通发布。
管理界面的强制发布要求全局管理员、可写资源、`reviewing/reviewed` 和当前 `REJECTED`；
`reviewing` 有当前终态结果时允许提交恢复。`latest` 由服务端管理。

Skill 单包上传先预检，覆盖草稿需要确认。AgentSpec 编辑保留完整 manifest 与资源文件映射，
更新是整体替换。Copilot 仅配置 DashScope/Qwen 与 Studio，属于平台设置，密钥默认遮蔽、
清空需要确认；不添加聊天、推理或自动模型测试。

界面包含可关闭的独立演示入口；演示数据仅在浏览器中运行，显著标记为演示环境，
不向真实后端发送请求。真实登录失败不得转为演示登录。账号、token 和密钥不写入构建产物。

验证范围：类型检查、ESLint、接口契约单测、浏览器登录/过期/无权限、配置读写、命名空间隔离、
服务详情和实例操作、菜单折叠、深色模式、桌面与窄屏、静态子路径部署；AI 增量覆盖资源与版本身份、
当前审核状态、只读与管理员入口、内容/资源保留、上传预检和 Copilot JSON 传输。
已完成与待完成的验证分别记录于 `docs/validation.md`，本设计范围不代表全部运行环境均已验证。

上游参考与许可证见 `THIRD_PARTY_NOTICES.md`。
