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

import com.alibaba.nacos.plugin.datasource.constants.DatabaseTypeConstant;
import com.alibaba.nacos.plugin.datasource.constants.TableConstant;

import java.util.Arrays;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TenantInfoMapperByDmTest {
    
    private TenantInfoMapperByDm tenantInfoMapperByDm;
    
    @BeforeEach
    void setUp() throws Exception {
        tenantInfoMapperByDm = new TenantInfoMapperByDm();
    }
    
    @Test
    void testGetTableName() {
        String tableName = tenantInfoMapperByDm.getTableName();
        assertEquals(TableConstant.TENANT_INFO, tableName);
    }
    
    @Test
    void testGetDataSource() {
        String dataSource = tenantInfoMapperByDm.getDataSource();
        assertEquals(DatabaseTypeConstant.DM, dataSource);
    }
    
    @Test
    void testInsertPreservesEpochMillisParameters() {
        String sql = tenantInfoMapperByDm.insert(Arrays.asList("kp", "tenant_id", "tenant_name",
            "tenant_desc", "create_source", "gmt_create", "gmt_modified"));
        assertEquals(
            "INSERT INTO tenant_info(kp, tenant_id, tenant_name, tenant_desc, create_source, "
                + "gmt_create, gmt_modified) VALUES(?,?,?,?,?,?,?)",
            sql);
    }
    
    @Test
    void testUpdatePreservesEpochMillisParameters() {
        String sql = tenantInfoMapperByDm.update(
            Arrays.asList("tenant_name", "tenant_desc", "gmt_modified"),
            Arrays.asList("kp", "tenant_id"));
        assertEquals("UPDATE tenant_info SET tenant_name = ?,tenant_desc = ?,"
            + "gmt_modified = ? "
            + "WHERE kp = ? AND tenant_id = ?", sql);
    }
}
