# Arco Console 第一版

基于 Arco Design Pro 官方后台结构与官方 `react-arco-pro` 主题，使用 Arco 的
Layout、Menu、Breadcrumb、Card、Table、Form、Modal、Drawer、Tabs、Tag、Message 和 Result。
不另外设计组件、字体、阴影、图标或主题。页面只增加业务布局所需的尺寸与间距。

采用独立前端工程和 Hash Router，通过同源 `/platform-api/` 代理复用 Nacos 3.3.0 的
Console/Auth API。服务端、业务 SDK、登录协议和数据模型不变。

第一版范围：登录、概览、命名空间、配置查询/新增/编辑/删除/历史、监听查询、服务列表与
实例详情、订阅者查询、集群节点，以及用户/角色/权限只读查询。
配置编辑器使用本地打包的 Monaco，发布与删除需要明确确认。

界面包含可关闭的独立演示入口；演示数据仅在浏览器中运行，显著标记为演示环境，
不向真实后端发送请求。真实登录失败不得转为演示登录。账号、token 和密钥不写入构建产物。

验证范围：类型检查、ESLint、接口契约单测、浏览器登录/过期/无权限、配置读写、命名空间隔离、
服务详情和实例操作、菜单折叠、深色模式、桌面与窄屏、静态子路径部署。

上游参考与许可证见 `THIRD_PARTY_NOTICES.md`。
