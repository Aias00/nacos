/*
 * Copyright 1999-2018 Alibaba Group Holding Ltd.
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

-- Dameng DM8, UTF-8, CASE_SENSITIVE=Y, COMPATIBLE_MODE=0.
-- Execute in a dedicated application user/schema; do not run as SYSDBA in production.
-- Fresh installation only. Existing databases require a separately reviewed migration.

CREATE TABLE config_info (
    id BIGINT IDENTITY(1, 1),
    data_id VARCHAR(255 CHAR) NOT NULL,
    group_id VARCHAR(128 CHAR) NOT NULL,
    tenant_id VARCHAR(128 CHAR) DEFAULT '',
    app_name VARCHAR(128 CHAR),
    content CLOB,
    md5 VARCHAR(32 CHAR) DEFAULT NULL,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    src_user VARCHAR(128 CHAR) DEFAULT NULL,
    src_ip VARCHAR(50 CHAR) DEFAULT NULL,
    c_desc VARCHAR(256 CHAR) DEFAULT NULL,
    c_use VARCHAR(64 CHAR) DEFAULT NULL,
    effect VARCHAR(64 CHAR) DEFAULT NULL,
    type VARCHAR(64 CHAR) DEFAULT NULL,
    c_schema CLOB DEFAULT NULL,
    encrypted_data_key VARCHAR(1024 CHAR) DEFAULT NULL,
    CONSTRAINT configinfo_id_key PRIMARY KEY (id),
    CONSTRAINT uk_configinfo_datagrouptenant UNIQUE (data_id, group_id, tenant_id)
);

CREATE INDEX configinfo_dataid_key_idx ON config_info(data_id);
CREATE INDEX configinfo_groupid_key_idx ON config_info(group_id);
CREATE INDEX configinfo_dataid_group_key_idx ON config_info(data_id, group_id);

CREATE TABLE his_config_info (
    id BIGINT NOT NULL,
    nid BIGINT IDENTITY(1, 1),
    data_id VARCHAR(255 CHAR) NOT NULL,
    group_id VARCHAR(128 CHAR) NOT NULL,
    tenant_id VARCHAR(128 CHAR) DEFAULT '',
    app_name VARCHAR(128 CHAR),
    content CLOB,
    md5 VARCHAR(32 CHAR) DEFAULT NULL,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    src_user VARCHAR(128 CHAR),
    src_ip VARCHAR(50 CHAR) DEFAULT NULL,
    publish_type VARCHAR(50 CHAR) DEFAULT 'formal',
    gray_name VARCHAR(128 CHAR) DEFAULT NULL,
    ext_info CLOB,
    op_type CHAR(10) DEFAULT NULL,
    encrypted_data_key VARCHAR(1024 CHAR) DEFAULT NULL,
    CONSTRAINT hisconfiginfo_nid_key PRIMARY KEY (nid)
);

CREATE INDEX hisconfiginfo_dataid_key_idx ON his_config_info(data_id);
CREATE INDEX hisconfiginfo_gmt_create_idx ON his_config_info(gmt_create);
CREATE INDEX hisconfiginfo_gmt_modified_idx ON his_config_info(gmt_modified);

CREATE TABLE config_info_gray (
    id BIGINT IDENTITY(1, 1),
    data_id VARCHAR(255 CHAR) NOT NULL,
    group_id VARCHAR(128 CHAR) NOT NULL,
    tenant_id VARCHAR(128 CHAR) DEFAULT '',
    gray_name VARCHAR(128 CHAR) NOT NULL,
    gray_rule CLOB,
    app_name VARCHAR(128 CHAR),
    src_ip VARCHAR(128 CHAR),
    src_user VARCHAR(128 CHAR) DEFAULT '',
    content CLOB,
    md5 VARCHAR(32 CHAR) DEFAULT NULL,
    encrypted_data_key VARCHAR(256 CHAR) DEFAULT NULL,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT configinfogray_id_key PRIMARY KEY (id),
    CONSTRAINT uk_configinfogray_datagrouptenantgrayname UNIQUE (data_id, group_id, tenant_id, gray_name)
);

CREATE INDEX config_info_gray_dataid_gmt_modified ON config_info_gray(data_id, gmt_modified);
CREATE INDEX config_info_gray_gmt_modified ON config_info_gray(gmt_modified);

CREATE TABLE config_tags_relation (
    id BIGINT NOT NULL,
    tag_name VARCHAR(128 CHAR) NOT NULL,
    tag_type VARCHAR(64 CHAR) DEFAULT NULL,
    data_id VARCHAR(255 CHAR) NOT NULL,
    group_id VARCHAR(128 CHAR) NOT NULL,
    tenant_id VARCHAR(128 CHAR) DEFAULT '',
    nid BIGINT IDENTITY(1, 1),
    CONSTRAINT config_tags_id_key PRIMARY KEY (nid),
    CONSTRAINT uk_configtagrelation_configidtag UNIQUE (id, tag_name, tag_type)
);

CREATE INDEX config_tags_tenant_id_idx ON config_tags_relation(tenant_id);

CREATE TABLE group_capacity (
    id BIGINT IDENTITY(1, 1),
    group_id VARCHAR(128 CHAR) DEFAULT '',
    quota INTEGER DEFAULT 0,
    usage INTEGER DEFAULT 0,
    max_size INTEGER DEFAULT 0,
    max_aggr_count INTEGER DEFAULT 0,
    max_aggr_size INTEGER DEFAULT 0,
    max_history_count INTEGER DEFAULT 0,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT group_capacity_id_key PRIMARY KEY (id),
    CONSTRAINT uk_group_id UNIQUE (group_id)
);

CREATE TABLE tenant_capacity (
    id BIGINT IDENTITY(1, 1),
    tenant_id VARCHAR(128 CHAR) DEFAULT '',
    quota INTEGER DEFAULT 0,
    usage INTEGER DEFAULT 0,
    max_size INTEGER DEFAULT 0,
    max_aggr_count INTEGER DEFAULT 0,
    max_aggr_size INTEGER DEFAULT 0,
    max_history_count INTEGER DEFAULT 0,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tenant_capacity_id_key PRIMARY KEY (id),
    CONSTRAINT uk_tenant_id UNIQUE (tenant_id)
);

CREATE TABLE tenant_info (
    id BIGINT IDENTITY(1, 1),
    kp VARCHAR(128 CHAR) NOT NULL,
    tenant_id VARCHAR(128 CHAR) DEFAULT '',
    tenant_name VARCHAR(128 CHAR) DEFAULT '',
    tenant_desc VARCHAR(256 CHAR) DEFAULT NULL,
    create_source VARCHAR(32 CHAR) DEFAULT NULL,
    gmt_create BIGINT NOT NULL,
    gmt_modified BIGINT NOT NULL,
    CONSTRAINT tenant_info_id_key PRIMARY KEY (id),
    CONSTRAINT uk_tenant_info_kptenantid UNIQUE (kp, tenant_id)
);

CREATE INDEX tenant_info_tenant_id_idx ON tenant_info(tenant_id);

CREATE TABLE users (
    username VARCHAR(50 CHAR) NOT NULL PRIMARY KEY,
    password VARCHAR(500 CHAR) NOT NULL,
    enabled NUMBER(1) NOT NULL DEFAULT 1
);

CREATE TABLE roles (
    username VARCHAR(50 CHAR) NOT NULL,
    role VARCHAR(50 CHAR) NOT NULL,
    CONSTRAINT uk_username_role UNIQUE (username, role)
);

CREATE TABLE permissions (
    role VARCHAR(50 CHAR) NOT NULL,
    resource VARCHAR(512 CHAR) NOT NULL,
    action VARCHAR(8 CHAR) NOT NULL,
    CONSTRAINT uk_role_permission UNIQUE (role, resource, action)
);


/******************************************/
/*   ipv6 support   */
/******************************************/

-- Note: In Dameng, ALTER TABLE ADD for existing columns should be handled carefully
-- The following statements are kept for compatibility but may need adjustment if columns already exist

-- ALTER TABLE his_config_info ADD src_ip VARCHAR(50 CHAR) DEFAULT NULL;

-- ALTER TABLE config_info ADD src_ip VARCHAR(50 CHAR) DEFAULT NULL;


/******************************************/
/*   support gray history since 2.5.0   */
/******************************************/

-- Note: These columns are already included in the CREATE TABLE statement above
-- The following ALTER statements are kept for reference when upgrading from older versions

-- ALTER TABLE his_config_info ADD publish_type VARCHAR(50 CHAR) DEFAULT 'formal';
-- ALTER TABLE his_config_info ADD ext_info CLOB DEFAULT NULL;
-- ALTER TABLE his_config_info ADD gray_name VARCHAR(128 CHAR) DEFAULT NULL;


/******************************************/
/*   表名称 = pipeline_execution           */
/******************************************/
CREATE TABLE pipeline_execution (
    execution_id  VARCHAR(64 CHAR)  NOT NULL,
    resource_type VARCHAR(32 CHAR)  NOT NULL,
    resource_name VARCHAR(256 CHAR) NOT NULL,
    namespace_id  VARCHAR(128 CHAR) DEFAULT NULL,
    version       VARCHAR(64 CHAR)  DEFAULT NULL,
    status        VARCHAR(32 CHAR)  NOT NULL,
    pipeline      CLOB          NOT NULL,
    create_time   BIGINT    NOT NULL,
    update_time   BIGINT    NOT NULL,
    CONSTRAINT pk_pipeline_execution PRIMARY KEY (execution_id)
);

/******************************************/
/*   表名称 = ai_resource                 */
/******************************************/
CREATE TABLE ai_resource (
    id BIGINT IDENTITY(1, 1) PRIMARY KEY,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    name VARCHAR(256 CHAR) NOT NULL,
    type VARCHAR(32 CHAR) NOT NULL,
    c_desc VARCHAR(2048 CHAR) DEFAULT NULL,
    status VARCHAR(32 CHAR) DEFAULT NULL,
    namespace_id VARCHAR(128 CHAR) DEFAULT '' NOT NULL,
    biz_tags VARCHAR(1024 CHAR) DEFAULT NULL,
    ext CLOB DEFAULT NULL,
    c_from VARCHAR(256 CHAR) DEFAULT 'local' NOT NULL,
    version_info CLOB DEFAULT NULL,
    meta_version BIGINT DEFAULT 1 NOT NULL,
    scope VARCHAR(16 CHAR) DEFAULT 'PRIVATE' NOT NULL,
    owner VARCHAR(128 CHAR) DEFAULT '' NOT NULL,
    download_count BIGINT DEFAULT 0 NOT NULL,
    CONSTRAINT uk_ai_resource_ns_name_type UNIQUE (namespace_id, name, type, c_from)
);

CREATE INDEX idx_ai_resource_name ON ai_resource(name);
CREATE INDEX idx_ai_resource_type ON ai_resource(type);
CREATE INDEX idx_ai_resource_gmt_modified ON ai_resource(gmt_modified);

/******************************************/
/*   表名称 = ai_resource_version         */
/******************************************/
CREATE TABLE ai_resource_version (
    id BIGINT IDENTITY(1, 1) PRIMARY KEY,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    type VARCHAR(32 CHAR) NOT NULL,
    author VARCHAR(128 CHAR) DEFAULT NULL,
    name VARCHAR(256 CHAR) NOT NULL,
    c_desc VARCHAR(2048 CHAR) DEFAULT NULL,
    status VARCHAR(32 CHAR) NOT NULL,
    version VARCHAR(64 CHAR) NOT NULL,
    namespace_id VARCHAR(128 CHAR) DEFAULT '' NOT NULL,
    storage CLOB DEFAULT NULL,
    publish_pipeline_info CLOB DEFAULT NULL,
    download_count BIGINT DEFAULT 0 NOT NULL,
    CONSTRAINT uk_ai_res_ver_ns_nm_tp_ver UNIQUE (namespace_id, name, type, version)
);

CREATE INDEX idx_ai_res_ver_name ON ai_resource_version(name);
CREATE INDEX idx_ai_res_ver_status ON ai_resource_version(status);
CREATE INDEX idx_ai_res_ver_gmt_mod ON ai_resource_version(gmt_modified);

/******************************************/
/*   表名称 = ai_resource_search_document       */
/******************************************/
CREATE TABLE ai_resource_search_document (
    id BIGINT IDENTITY(1, 1) PRIMARY KEY,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    namespace_id VARCHAR(128 CHAR) DEFAULT '' NOT NULL,
    resource_type VARCHAR(32 CHAR) NOT NULL,
    resource_name VARCHAR(256 CHAR) NOT NULL,
    resource_version VARCHAR(64 CHAR) NOT NULL,
    display_name VARCHAR(256 CHAR) NOT NULL,
    c_desc VARCHAR(2048 CHAR) DEFAULT NULL,
    tags CLOB DEFAULT NULL,
    capabilities CLOB DEFAULT NULL,
    representative_queries CLOB DEFAULT NULL,
    metadata CLOB DEFAULT NULL,
    source_digest VARCHAR(64 CHAR) NOT NULL,
    status VARCHAR(32 CHAR) NOT NULL,
    generate_mode VARCHAR(32 CHAR) NOT NULL,
    CONSTRAINT uk_search_document_res_ver UNIQUE (namespace_id, resource_type, resource_name, resource_version)
);

CREATE INDEX idx_search_document_type_status ON ai_resource_search_document(namespace_id, resource_type, status, resource_name, id);

/******************************************/
/*   表名称 = ai_resource_search_chunk       */
/******************************************/
CREATE TABLE ai_resource_search_chunk (
    id BIGINT IDENTITY(1, 1) PRIMARY KEY,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    document_id BIGINT NOT NULL,
    namespace_id VARCHAR(128 CHAR) DEFAULT '' NOT NULL,
    resource_type VARCHAR(32 CHAR) NOT NULL,
    resource_name VARCHAR(256 CHAR) NOT NULL,
    resource_version VARCHAR(64 CHAR) NOT NULL,
    chunk_type VARCHAR(64 CHAR) NOT NULL,
    chunk_text CLOB NOT NULL,
    canonical_text CLOB NOT NULL,
    language VARCHAR(16 CHAR) DEFAULT NULL,
    chunk_hash VARCHAR(64 CHAR) NOT NULL,
    metadata CLOB DEFAULT NULL,
    status VARCHAR(32 CHAR) NOT NULL
);

CREATE INDEX idx_search_chunk_document ON ai_resource_search_chunk(document_id);
CREATE INDEX idx_search_chunk_hash ON ai_resource_search_chunk(chunk_hash);
CREATE INDEX idx_search_chunk_resource ON ai_resource_search_chunk(namespace_id, resource_type, resource_name, resource_version);
CREATE INDEX idx_search_chunk_type_status ON ai_resource_search_chunk(namespace_id, resource_type, status);

/******************************************/
/*   表名称 = ai_resource_task  */
/******************************************/
CREATE TABLE ai_resource_task (
    task_key VARCHAR(64 CHAR) PRIMARY KEY,
    namespace_id VARCHAR(128 CHAR) DEFAULT '' NOT NULL,
    task_type VARCHAR(64 CHAR) NOT NULL,
    task_stage VARCHAR(32 CHAR) NOT NULL,
    status VARCHAR(16 CHAR) NOT NULL,
    task_payload CLOB NOT NULL,
    task_result CLOB,
    retry_count INTEGER DEFAULT 0 NOT NULL,
    revision BIGINT DEFAULT 1 NOT NULL,
    lease_token BIGINT DEFAULT 0 NOT NULL,
    next_execute_at BIGINT NOT NULL,
    lease_expire_at BIGINT DEFAULT NULL,
    last_error VARCHAR(2000 CHAR) DEFAULT NULL,
    gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gmt_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_ai_resource_task_due ON ai_resource_task(task_type, status, next_execute_at);
CREATE INDEX idx_ai_resource_task_lease ON ai_resource_task(task_type, status, lease_expire_at);
