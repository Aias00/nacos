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

package com.alibaba.nacos.plugin.datasource.impl.dialect;

import com.alibaba.nacos.plugin.datasource.constants.DatabaseTypeConstant;
import org.junit.jupiter.api.Test;
import java.sql.SQLException;
import java.util.ServiceLoader;
import java.util.HashSet;
import java.util.Set;
import com.alibaba.nacos.plugin.datasource.mapper.Mapper;
import com.alibaba.nacos.plugin.datasource.dialect.DatabaseDialect;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DmDatabaseDialectTest {
    
    @Test
    void testGetDefaultDriverClassName() {
        DmDatabaseDialect dialect = new DmDatabaseDialect();
        assertEquals(DatabaseTypeConstant.DM, dialect.getType());
        assertEquals("dm.jdbc.driver.DmDriver", dialect.getDefaultDriverClassName());
    }
    
    @Test
    void generatedKeysAndPaginationUseDmContract() {
        DmDatabaseDialect dialect = new DmDatabaseDialect();
        assertArrayEquals(new String[] {"ID"}, dialect.getReturnPrimaryKeys());
        assertEquals("SELECT id FROM config_info FETCH FIRST ? ROWS ONLY",
            dialect.getLimitTopSqlWithMark("SELECT id FROM config_info"));
        assertEquals("SELECT id FROM config_info OFFSET ? ROWS FETCH NEXT ? ROWS ONLY",
            dialect.getLimitPageSqlWithMark("SELECT id FROM config_info"));
        assertEquals("SELECT id FROM config_info OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY",
            dialect.getLimitPageSql("SELECT id FROM config_info", 3, 5));
        assertEquals(10, dialect.getPagePrevNum(3, 5));
        assertEquals(5, dialect.getPageLastNum(3, 5));
    }
    
    @Test
    void duplicateDetectionWalksBatchExceptionsWithoutBroadIntegrityClassification() {
        DmDatabaseDialect dialect = new DmDatabaseDialect();
        SQLException batch = new SQLException("batch failed", "23000", -1);
        batch.setNextException(new SQLException("duplicate", "23000", -6602));
        assertTrue(dialect.isDuplicateKeyException(new RuntimeException(batch)));
        assertFalse(dialect.isDuplicateKeyException(new SQLException("not null", "23000", -6603)));
        assertFalse(dialect.isDuplicateKeyException(null));
    }
    
    @Test
    void spiProvidesOneDialectAndEveryMapperFamily() {
        long dialects = ServiceLoader.load(DatabaseDialect.class).stream()
            .map(ServiceLoader.Provider::get).filter(d -> "dm".equals(d.getType())).count();
        assertEquals(1L, dialects);
        Set<String> tables = new HashSet<>();
        for (Mapper mapper : ServiceLoader.load(Mapper.class)) {
            if ("dm".equals(mapper.getDataSource())) {
                assertTrue(tables.add(mapper.getTableName()));
            }
        }
        assertEquals(Set.of("config_info", "config_info_gray", "config_tags_relation",
            "his_config_info", "tenant_info", "tenant_capacity", "group_capacity",
            "ai_resource", "ai_resource_version"), tables);
    }
    
}
