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

# Dameng DM8 datasource plugin

This optional plugin selects DM8 with `nacos.plugin.datasource-dialect.type=dm`.
The ordinary distribution does not need the plugin or the DM JDBC driver.
Use DM8 native mode (`COMPATIBLE_MODE=0`), UTF-8 and case-sensitive comparison
(`CASE_SENSITIVE=Y`); Oracle-compatible empty-string-to-NULL behavior is not supported.
Initialize a dedicated application schema with `distribution/conf/dameng-schema.sql`.
The same fresh-install schema is packaged as `META-INF/dameng-schema.sql`.
The script does not create a default administrator or alter other schemas.

Put these files under `${nacos.home}/plugins`:

- `nacos-datasource-plugin-dm-3.3.0.jar`
- `DmJdbcDriver8-8.1.5.45.jar` (`com.dameng:DmJdbcDriver8:8.1.5.45`)

Existing datasource SPI/base modules are supplied by the Nacos server. This plugin
has no Oracle-plugin or Oracle-driver dependency. The JDBC driver is architecture
independent and supports Java 8 and later, including the server's Java 17 runtime.

```properties
nacos.plugin.datasource-dialect.type=dm
nacos.plugin.datasource.db.num=1
nacos.plugin.datasource.db.url.0=jdbc:dm://db-host:5236
nacos.plugin.datasource.db.user=YOUR_APPLICATION_USER
nacos.plugin.datasource.db.password=YOUR_APPLICATION_PASSWORD
nacos.plugin.datasource.db.pool.config.driver-class-name=dm.jdbc.driver.DmDriver
nacos.plugin.datasource.db.pool.config.connection-test-query=SELECT 1 FROM DUAL
```

Use one application user/schema for the tables; unquoted names use DM's ordinary
uppercase identifier rules. Do not put production credentials in an image layer.
The schema is for a fresh Nacos 3.3 installation, not an automatic migration from
another database or from Nacos versions before 3.0.

## Behavior and verification

Nine table mapper providers cover configuration, gray configuration, tags, history,
namespace/capacity and AI resource/version tables. Authentication, pipeline and AI
search/task tables are included in the schema for their shared JDBC repositories.
DM-specific behavior includes ANSI pagination, uppercase generated ID columns,
single-character LIKE escape, deterministic outer page/keyset ordering, explicit
character-length VARCHAR columns, CLOB content/history extension storage, native empty
string preservation, and conservative duplicate-key error `-6602` classification.
Namespace creation/modification times remain epoch-millisecond BIGINT values;
configuration/history time fields use JDBC timestamps.

Real JDBC regression also checks full/tail/out-of-range config pages with and without
tags, capacity keyset scans and maximum-length Chinese Data ID/Group round trips.

The opt-in JDBC test requires a pre-initialized dedicated test schema. Supply a private
properties file containing `url`, `username` and `password`; tests roll back inserted
fixture rows. Do not point this test at a production schema.

```bash
mvn -pl plugin-default-impl/nacos-default-datasource-plugin/nacos-datasource-plugin-dm \
  -Ddm.it.properties=/absolute/private/test.properties test
```

Official references:

- [DM JDBC driver and URL](https://eco.dameng.com/document/dm/zh-cn/app-dev/java-jdbc.html)
- [DM pagination SQL](https://eco.dameng.com/document/dm/zh-cn/pm/check-phrases.html)
- [DM driver releases](https://repo.maven.apache.org/maven2/com/dameng/DmJdbcDriver8/)
