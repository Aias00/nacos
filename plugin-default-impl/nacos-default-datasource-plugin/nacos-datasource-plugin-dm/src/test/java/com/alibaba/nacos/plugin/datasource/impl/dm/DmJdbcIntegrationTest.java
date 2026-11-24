/*
 * Copyright 1999-2026 Alibaba Group Holding Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.alibaba.nacos.plugin.datasource.impl.dm;

import com.alibaba.nacos.plugin.datasource.impl.dialect.DmDatabaseDialect;
import com.alibaba.nacos.plugin.datasource.constants.FieldConstant;
import com.alibaba.nacos.plugin.datasource.model.MapperContext;
import com.alibaba.nacos.plugin.datasource.model.MapperResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import java.io.FileInputStream;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Arrays;
import java.util.Properties;
import java.util.UUID;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Opt-in JDBC checks against an initialized, dedicated DM8 test schema.
 */
@EnabledIfSystemProperty(named = "dm.it.properties", matches = ".+")
class DmJdbcIntegrationTest {
    
    private Connection connection;
    
    private final String dataId = "dm_it_" + UUID.randomUUID();
    
    @BeforeEach
    void connect() throws Exception {
        Properties settings = new Properties();
        try (FileInputStream input = new FileInputStream(System.getProperty("dm.it.properties"))) {
            settings.load(input);
        }
        connection = DriverManager.getConnection(settings.getProperty("url"),
            settings.getProperty("username"), settings.getProperty("password"));
        connection.setAutoCommit(false);
    }
    
    @AfterEach
    void close() throws Exception {
        if (connection != null) {
            connection.rollback();
            connection.close();
        }
    }
    
    @Test
    void generatedKeyAndLargeUnicodeClobRoundTrip() throws Exception {
        String content = "配置内容\n".repeat(20000);
        long id = insertConfig(content);
        assertTrue(id > 0);
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT content,gmt_create FROM config_info WHERE id=?")) {
            statement.setLong(1, id);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next());
                assertEquals(content, rows.getString("content"));
                assertTrue(rows.getTimestamp("gmt_create").getTime() > 0);
            }
        }
    }
    
    @Test
    void fuzzyUnderscoreAndPagedMetadataPreserveIdentity() throws Exception {
        insertConfig("value=initial");
        MapperContext context = new MapperContext(0, 10);
        context.putWhereParameter(FieldConstant.TENANT_ID, "public");
        context.putWhereParameter(FieldConstant.DATA_ID, dataId.replace("_", "\\_") + "%");
        context.putWhereParameter(FieldConstant.GROUP_ID, "DEFAULT\\_GROUP");
        ConfigInfoMapperByDm mapper = new ConfigInfoMapperByDm();
        MapperResult query = mapper.findConfigInfoLike4PageFetchRows(context);
        try (PreparedStatement statement = prepare(query);
            ResultSet rows = statement.executeQuery()) {
            assertTrue(rows.next());
            assertEquals(dataId, rows.getString("data_id"));
            assertEquals("DEFAULT_GROUP", rows.getString("group_id"));
            assertFalse(rows.next());
        }
        context.putWhereParameter(FieldConstant.DATA_ID, "' OR 1=1 --");
        try (
            PreparedStatement statement = prepare(mapper.findConfigInfoLike4PageFetchRows(context));
            ResultSet rows = statement.executeQuery()) {
            assertFalse(rows.next());
        }
    }
    
    @Test
    void namespaceEpochMillisRemainExact() throws Exception {
        TenantInfoMapperByDm mapper = new TenantInfoMapperByDm();
        String sql = mapper
            .insert(Arrays.asList("kp", "tenant_id", "tenant_name", "gmt_create", "gmt_modified"));
        long epoch = 1700000000123L;
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, "1");
            statement.setString(2, dataId);
            statement.setString(3, "达梦空间");
            statement.setLong(4, epoch);
            statement.setLong(5, epoch);
            assertEquals(1, statement.executeUpdate());
        }
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT gmt_create FROM tenant_info WHERE tenant_id=?")) {
            statement.setString(1, dataId);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next());
                assertEquals(epoch, rows.getLong(1));
            }
        }
    }
    
    @Test
    void duplicateConstraintIsDistinguishedFromOtherFailures() throws Exception {
        insertConfig("first");
        SQLException duplicate = assertThrows(SQLException.class, () -> insertConfig("second"));
        DmDatabaseDialect dialect = new DmDatabaseDialect();
        assertTrue(dialect.isDuplicateKeyException(duplicate));
        SQLException missing = assertThrows(SQLException.class, () -> connection.createStatement()
            .executeQuery("SELECT * FROM dm_it_missing_table"));
        assertFalse(dialect.isDuplicateKeyException(missing));
    }
    
    @Test
    void historyExtensionClobAndNativeEmptyStringArePreserved() throws Exception {
        String extension = "{\"change_message\":\"达梦发布\",\"custom\":\"" + "x".repeat(70000) + "\"}";
        try (PreparedStatement statement = connection.prepareStatement(
            "INSERT INTO his_config_info(id,data_id,group_id,tenant_id,ext_info) VALUES(?,?,?,?,?)")) {
            statement.setLong(1, 1L);
            statement.setString(2, dataId);
            statement.setString(3, "DEFAULT_GROUP");
            statement.setString(4, "public");
            statement.setString(5, extension);
            assertEquals(1, statement.executeUpdate());
        }
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT ext_info FROM his_config_info WHERE data_id=?")) {
            statement.setString(1, dataId);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next());
                assertEquals(extension, rows.getString(1));
            }
        }
        try (PreparedStatement statement = connection.prepareStatement(
            "INSERT INTO ai_resource(name,type,namespace_id,owner) VALUES(?,?,?,?)")) {
            statement.setString(1, dataId);
            statement.setString(2, "prompt");
            statement.setString(3, "public");
            statement.setString(4, "");
            assertEquals(1, statement.executeUpdate());
        }
    }
    
    @Test
    void dialectPaginationBindsOffsetAndLimitInOrder() throws Exception {
        DmDatabaseDialect dialect = new DmDatabaseDialect();
        String sql = dialect.getLimitPageSqlWithMark("SELECT id FROM config_info ORDER BY id");
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setInt(1, dialect.getPagePrevNum(1, 2));
            statement.setInt(2, dialect.getPageLastNum(1, 2));
            try (ResultSet rows = statement.executeQuery()) {
                int count = 0;
                while (rows.next()) {
                    count++;
                }
                assertTrue(count <= 2);
            }
        }
    }
    
    @Test
    void joinedConfigPagesHaveStableOrderWithoutOverlap() throws Exception {
        String group = "page_" + UUID.randomUUID();
        List<Long> inserted = new ArrayList<>();
        for (int index = 0; index < 5; index++) {
            String name = dataId + "_" + index;
            long id = insertConfig(name, group, "key=" + index);
            inserted.add(id);
            try (PreparedStatement tag = connection.prepareStatement(
                "INSERT INTO config_tags_relation(id,tag_name,data_id,group_id,tenant_id) VALUES(?,?,?,?,?)")) {
                tag.setLong(1, id);
                tag.setString(2, "page-tag");
                tag.setString(3, name);
                tag.setString(4, group);
                tag.setString(5, "public");
                tag.executeUpdate();
            }
        }
        for (boolean tagged : new boolean[] {false, true}) {
            for (boolean fuzzy : new boolean[] {false, true}) {
                List<Long> found = new ArrayList<>();
                for (int offset : new int[] {0, 2, 4, 6}) {
                    MapperContext context = new MapperContext(offset, 2);
                    context.putWhereParameter(FieldConstant.TENANT_ID, "public");
                    context.putWhereParameter(FieldConstant.GROUP_ID,
                        fuzzy ? group.replace("_", "\\_") : group);
                    context.putWhereParameter(FieldConstant.TAG_ARR, new String[] {"page-tag"});
                    MapperResult result;
                    if (tagged) {
                        ConfigTagsRelationMapperByDm mapper = new ConfigTagsRelationMapperByDm();
                        result = fuzzy ? mapper.findConfigInfoLike4PageFetchRows(context)
                            : mapper.findConfigInfo4PageFetchRows(context);
                    } else {
                        ConfigInfoMapperByDm mapper = new ConfigInfoMapperByDm();
                        result = fuzzy ? mapper.findConfigInfoLike4PageFetchRows(context)
                            : mapper.findConfigInfo4PageFetchRows(context);
                    }
                    assertTrue(result.getSql().endsWith("ORDER BY a.id"));
                    int count = 0;
                    try (PreparedStatement statement = prepare(result);
                        ResultSet rows = statement.executeQuery()) {
                        while (rows.next()) {
                            found.add(rows.getLong("id"));
                            assertEquals("page-tag", rows.getString("config_tags"));
                            count++;
                        }
                    }
                    assertEquals(offset < 4 ? 2 : offset == 4 ? 1 : 0, count);
                }
                assertEquals(inserted, found);
            }
        }
    }
    
    @Test
    void capacityKeysetScansDoNotSkipRows() throws Exception {
        for (String table : new String[] {"group_capacity", "tenant_capacity"}) {
            long baseline;
            try (PreparedStatement statement = connection.prepareStatement(
                "SELECT COALESCE(MAX(id),0) FROM " + table);
                ResultSet rows = statement.executeQuery()) {
                rows.next();
                baseline = rows.getLong(1);
            }
            List<Long> inserted = new ArrayList<>();
            String identity = table.equals("group_capacity") ? "group_id" : "tenant_id";
            for (int index = 0; index < 5; index++) {
                try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO " + table + "(" + identity + ") VALUES(?)", new String[] {"ID"})) {
                    statement.setString(1, dataId + index);
                    statement.executeUpdate();
                    try (ResultSet keys = statement.getGeneratedKeys()) {
                        keys.next();
                        inserted.add(keys.getLong(1));
                    }
                }
            }
            List<Long> found = new ArrayList<>();
            long last = baseline;
            for (int page = 0; page < 4; page++) {
                MapperContext context = new MapperContext(0, 2);
                context.putWhereParameter(FieldConstant.ID, last);
                context.putWhereParameter(FieldConstant.LIMIT_SIZE, 2);
                MapperResult result = table.equals("group_capacity")
                    ? new GroupCapacityMapperByDm().selectGroupInfoBySize(context)
                    : new TenantCapacityMapperByDm().getCapacityList4CorrectUsage(context);
                assertTrue(result.getSql().contains("ORDER BY id FETCH FIRST"));
                try (PreparedStatement statement = prepare(result);
                    ResultSet rows = statement.executeQuery()) {
                    while (rows.next()) {
                        last = rows.getLong("id");
                        found.add(last);
                    }
                }
            }
            assertEquals(inserted, found);
        }
    }
    
    @Test
    void maximumUnicodeConfigIdentityUsesCharacterLength() throws Exception {
        String name = "配".repeat(255);
        String group = "组".repeat(128);
        long id = insertConfig(name, group, "unicode boundary");
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT data_id,group_id FROM config_info WHERE id=?")) {
            statement.setLong(1, id);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next());
                assertEquals(name, rows.getString(1));
                assertEquals(group, rows.getString(2));
            }
        }
    }
    
    private long insertConfig(String content) throws Exception {
        return insertConfig(dataId, "DEFAULT_GROUP", content);
    }
    
    private long insertConfig(String name, String group, String content) throws Exception {
        String sql = new ConfigInfoMapperByDm().insert(Arrays.asList("data_id", "group_id",
            "tenant_id", "app_name", "content", "gmt_create", "gmt_modified"));
        try (PreparedStatement statement = connection.prepareStatement(sql,
            new DmDatabaseDialect().getReturnPrimaryKeys())) {
            statement.setString(1, name);
            statement.setString(2, group);
            statement.setString(3, "public");
            statement.setString(4, "dm-it");
            statement.setString(5, content);
            statement.setTimestamp(6, new Timestamp(System.currentTimeMillis()));
            statement.setTimestamp(7, new Timestamp(System.currentTimeMillis()));
            assertEquals(1, statement.executeUpdate());
            try (ResultSet keys = statement.getGeneratedKeys()) {
                assertTrue(keys.next());
                return keys.getLong(1);
            }
        }
    }
    
    private PreparedStatement prepare(MapperResult query) throws Exception {
        PreparedStatement statement = connection.prepareStatement(query.getSql());
        for (int index = 0; index < query.getParamList().size(); index++) {
            statement.setObject(index + 1, query.getParamList().get(index));
        }
        return statement;
    }
}
