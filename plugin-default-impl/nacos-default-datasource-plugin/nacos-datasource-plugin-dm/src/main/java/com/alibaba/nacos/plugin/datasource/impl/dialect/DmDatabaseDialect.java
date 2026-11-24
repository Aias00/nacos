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
import com.alibaba.nacos.plugin.datasource.constants.PrimaryKeyConstant;
import java.sql.SQLException;
import com.alibaba.nacos.plugin.datasource.impl.enums.dm.TrustedDmFunctionEnum;

/**
 * Dm database dialect.
 *
 * @author xiweng.yy
 */
public class DmDatabaseDialect extends AbstractDatabaseDialect {
    
    private static final String DEFAULT_DRIVER_CLASS_NAME = "dm.jdbc.driver.DmDriver";
    
    @Override
    public String getType() {
        return DatabaseTypeConstant.DM;
    }
    
    @Override
    public String getDefaultDriverClassName() {
        return DEFAULT_DRIVER_CLASS_NAME;
    }
    
    @Override
    public String getFunction(String functionName) {
        return TrustedDmFunctionEnum.getFunctionByName(functionName);
    }
    
    @Override
    public String getLimitTopSqlWithMark(String sql) {
        return sql + " FETCH FIRST ? ROWS ONLY";
    }
    
    @Override
    public String getLimitPageSqlWithMark(String sql) {
        return sql + " OFFSET ? ROWS FETCH NEXT ? ROWS ONLY";
    }
    
    @Override
    public String getLimitPageSql(String sql, int pageNo, int pageSize) {
        return getLimitPageSqlWithOffset(sql, getPagePrevNum(pageNo, pageSize), pageSize);
    }
    
    @Override
    public String getLimitPageSqlWithOffset(String sql, int startOffset, int pageSize) {
        return sql + " OFFSET " + startOffset + " ROWS FETCH NEXT " + pageSize + " ROWS ONLY";
    }
    
    @Override
    public String[] getReturnPrimaryKeys() {
        return PrimaryKeyConstant.UPPER_RETURN_PRIMARY_KEYS;
    }
    
    @Override
    public boolean isDuplicateKeyException(Throwable throwable) {
        if (super.isDuplicateKeyException(throwable)) {
            return true;
        }
        for (Throwable cause = throwable; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException) {
                for (SQLException sql = (SQLException) cause; sql != null; sql =
                    sql.getNextException()) {
                    if (sql.getErrorCode() == -6602) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    
}
