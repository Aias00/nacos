<!--
  Copyright 1999-2026 Alibaba Group Holding Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

# 默认数据源方言插件实现规范

## 范围

内置数据源方言实现位于 `plugin-default-impl/nacos-default-datasource-plugin`。它提供随
Nacos 服务端发行包一起发布的数据库方言和表级 mapper，是
[数据源方言插件规范](datasource-dialect-plugin-spec.md)的内置实现。

默认实现集合是持久化兼容层，不得引入数据库特有的资源语义。

## 内置数据库类型

当前实现包含以下数据库族：

| 数据库类型 | Dialect provider | Mapper 包 |
|------------|------------------|-----------|
| `derby` | `DerbyDatabaseDialect` | `impl.derby` |
| `mysql` | `MysqlDatabaseDialect` 和 `DefaultDatabaseDialect` | `impl.mysql` |
| `postgresql` | `PostgresqlDatabaseDialect` | `impl.postgresql` |
| `oracle` | `OracleDatabaseDialect` | `impl.oracle` |

每个数据库包必须同时注册
`com.alibaba.nacos.plugin.datasource.dialect.DatabaseDialect` 和
`com.alibaba.nacos.plugin.datasource.mapper.Mapper` SPI 文件。

## Mapper 覆盖范围

每个内置数据库族都应提供以下 mapper 实现：

- 当前配置表：`config_info`、`config_info_gray`、`config_tags_relation`、`his_config_info`；
- 容量和命名空间表：`tenant_info`、`tenant_capacity`、`group_capacity`；
- AI Registry 表：AI 资源元数据和 AI 资源版本。

从 Nacos 3.3 版本线开始，内置数据库族不再要求提供默认 namespace 存储重复记录或 legacy
beta/tag 灰度表的运行时 Config 迁移 mapper。仍保留 pre-3.0 `config_info_beta` 或
`config_info_tag` 数据的部署，必须在升级到依赖当前 mapper 集合的 3.3 服务端前完成迁移。

如果未来 Nacos 版本新增持久化表，在该表成为文档化服务端能力之前，内置数据库族必须补充
对应 mapper。

## 选择

Nacos 从 `nacos.plugin.datasource-dialect.type` 选择启动数据库类型。
`spring.sql.init.platform` 继续作为历史 alias，不再支持 `spring.datasource.platform`。

当选择类型为 `mysql` 时，使用 MySQL mapper 和 MySQL 兼容的默认 dialect 行为。当选择类型
为 `derby` 时，Derby 仍是 standalone 开发和本地测试的嵌入式默认数据库。

## 兼容性

内置实现必须：

- 在不同数据库族之间保持 Nacos 逻辑 schema；
- 保持 SQL 占位符和参数顺序与 repository 代码兼容；
- 保持插入操作期望的生成主键列；
- 保持 AI 资源 mapper 行为与[资源模型](../design/resource-model-spec.md)对齐；
- 当某个数据库族需要 schema 变化时补充迁移说明。

`datasource-dialect` 类型加载后属于 critical。当前选中的内置方言不能通过运行时插件状态
禁用，但其他已加载内置方言不会仅因存在就分别成为 critical。

内置方言实现不持有数据源连接或连接池配置。它们通过 `DatabaseDialect` 继承
`PluginConfigSpec`，但不声明 definitions，因此以 `configurable=false` 暴露。Datasource
模块配置由上层数据源方言插件规范定义。

## 本分支可选的达梦 DM8 实现

`nacos-datasource-plugin-dm` 是独立打包的可选数据源插件，使用 `dm` 类型选择，
不替换普通发行版的数据源插件。插件注册 `DmDatabaseDialect` 和 `impl.dm` 下的九类表 Mapper。
要求 DM8 原生模式（`COMPATIBLE_MODE=0`）、UTF-8、大小写敏感字符串比较；
不支持 Oracle 兼容模式将空字符串视为 NULL 的语义。插件不内嵌驱动，达梦适配产物额外携带
`com.dameng:DmJdbcDriver8:8.1.5.45`，驱动类为 `dm.jdbc.driver.DmDriver`。
新建独立应用模式时使用 `distribution/conf/dameng-schema.sql`，插件内也提供
`META-INF/dameng-schema.sql`；已有数据库迁移需单独评审，不能直接执行新建脚本。
表语义与逻辑模型一致：命名空间时间为毫秒 BIGINT，配置/历史时间为 JDBC 时间戳，
配置内容及历史扩展为 CLOB，保留空 owner，返回大写 `ID` 生成键，并仅将 `-6602` 识别为重复键。
分页使用 OFFSET/FETCH，外层分页结果与容量游标扫描均显式排序，LIKE 声明单字符转义，
VARCHAR 显式使用字符长度。真实 JDBC 回归覆盖带/不带标签的完整页、尾页、越界页，
容量游标续扫及最大长度中文 Data ID/Group。可选外部 JDBC 测试通过私有属性文件读取
专用测试模式的凭据，验证以上方言差异；不提交数据库密码或在测试中启动服务端。
