/*
 * Copyright 1999-2026 Alibaba Group Holding Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
 * See the License for the specific language governing permissions and limitations.
 */
package cn.dap.cf;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Types;
import java.util.List;
import java.util.Map;

/** Dependency-free regression tests; run with java -ea. */
public final class SchemaInitializerTest {
    
    private SchemaInitializerTest() {
    }
    
    public static void main(String[] args) throws Exception {
        checkQuotedSemicolonsAndComments();
        checkDestructiveStatementsAreRejected();
        checkColumnAndKeyParsing();
        checkColumnCompatibility();
        checkEnvironmentValidation();
        checkCanonicalSchemas(Path.of(args[0]));
        System.out.println("Schema initializer parser/validation tests passed (6 groups)");
    }
    
    private static void checkQuotedSemicolonsAndComments() throws Exception {
        List<String> statements =
            SchemaInitializer.splitSql("/* ; */ CREATE TABLE t (v VARCHAR(20) DEFAULT 'a;b');"
                + "-- ignored ;\nCOMMENT ON COLUMN t.v IS 'it''s; a value';");
        require(statements.size() == 2, "A quoted semicolon must not split a statement");
        require(statements.get(0).contains("'a;b'"), "Quoted default changed");
        require(statements.get(1).endsWith("'it''s; a value'"), "Escaped quote changed");
        expectFailure(
            () -> SchemaInitializer.splitSql("CREATE TABLE t(v VARCHAR(20) DEFAULT 'unfinished)"));
        expectFailure(() -> SchemaInitializer.splitSql("/* unclosed"));
    }
    
    private static void checkDestructiveStatementsAreRejected() throws Exception {
        for (String forbidden : List.of("DROP TABLE IF EXISTS t", "DELETE FROM t",
            "TRUNCATE TABLE t",
            "INSERT INTO users VALUES('admin')", "CREATE DATABASE nacos",
            "ALTER TABLE t DROP COLUMN id",
            "UPDATE users SET password='secret'", "GRANT ALL ON t TO user", "SELECT 1")) {
            expectFailure(
                () -> SchemaInitializer.parse("CREATE TABLE t (id BIGINT);" + forbidden + ";"));
        }
        SchemaInitializer
            .parse("CREATE TABLE t (id BIGINT); COMMENT ON TABLE t IS 'DDL only'; BEGIN; COMMIT;");
    }
    
    private static void checkColumnAndKeyParsing() throws Exception {
        SchemaInitializer.Plan plan =
            SchemaInitializer.parse("CREATE TABLE `t` (id BIGINT IDENTITY(1,1),"
                + "name VARCHAR(255 CHAR) DEFAULT 'a,b', enabled BOOLEAN, content CLOB,"
                + "CONSTRAINT t_pk PRIMARY KEY(id), UNIQUE KEY uk_name(name));"
                + "CREATE INDEX idx_name ON t(name);"
                + "ALTER TABLE t ADD CONSTRAINT other UNIQUE(enabled);");
        require(plan.definitions().size() == 3, "Missing schema objects");
        SchemaInitializer.Definition table = plan.tables().get("t");
        require(table.columns().size() == 4 && table.keys().size() == 2, "Bad column/key split");
        require(table.columns().get(1).width() == 255, "Character semantics length not parsed");
        require(table.keys().get(0).primary(), "Primary key not parsed");
        require(table.keys().get(1).columns().equals(List.of("name")), "Unique key not parsed");
        expectFailure(() -> SchemaInitializer
            .parse("CREATE TABLE t (id BIGINT); CREATE INDEX i ON other(id);"));
        expectFailure(() -> SchemaInitializer
            .parse("CREATE TABLE t (id BIGINT); CREATE INDEX i ON t(lower(id));"));
    }
    
    private static void checkColumnCompatibility() {
        SchemaInitializer.Column wide =
            new SchemaInitializer.Column("id", SchemaInitializer.Family.BIGINT, 0);
        require(SchemaInitializer.compatible(wide, Types.BIGINT, 19), "BIGINT rejected");
        require(!SchemaInitializer.compatible(wide, Types.INTEGER, 10), "Narrow integer accepted");
        SchemaInitializer.Column counter =
            new SchemaInitializer.Column("count", SchemaInitializer.Family.INTEGER, 0);
        require(!SchemaInitializer.compatible(counter, Types.SMALLINT, 5),
            "Small counter accepted");
        SchemaInitializer.Column timestamp =
            new SchemaInitializer.Column("time", SchemaInitializer.Family.TIMESTAMP, 0);
        require(!SchemaInitializer.compatible(timestamp, Types.DATE, 10),
            "Date-only timestamp accepted");
        SchemaInitializer.Column name =
            new SchemaInitializer.Column("name", SchemaInitializer.Family.STRING, 255);
        require(SchemaInitializer.compatible(name, Types.VARCHAR, 512), "Wider varchar rejected");
        require(!SchemaInitializer.compatible(name, Types.VARCHAR, 128), "Narrow varchar accepted");
        require(!SchemaInitializer.compatible(name, Types.INTEGER, 512), "Wrong type accepted");
        SchemaInitializer.Column content =
            new SchemaInitializer.Column("content", SchemaInitializer.Family.TEXT, 1_073_741_824);
        require(!SchemaInitializer.compatible(content, Types.VARCHAR, 1),
            "Narrow content accepted");
        require(!SchemaInitializer.compatible(content, Types.VARCHAR, 65535),
            "Bounded content accepted");
        require(SchemaInitializer.compatible(content, Types.VARCHAR, Integer.MAX_VALUE),
            "Unbounded PostgreSQL text rejected");
        require(SchemaInitializer.compatible(content, Types.CLOB, 0), "CLOB rejected");
        require(!SchemaInitializer.compatible(content, Types.LONGVARCHAR, 255),
            "Tiny text content accepted");
    }
    
    private static void checkEnvironmentValidation() throws Exception {
        SchemaInitializer.run(Map.of("DB_TYPE", "derby"));
        SchemaInitializer.run(Map.of("DB_TYPE", "mysql", "DB_INIT_ENABLED", "false"));
        expectFailure(() -> SchemaInitializer.run(Map.of("DB_TYPE", "oracle")));
        expectFailure(
            () -> SchemaInitializer.run(Map.of("DB_TYPE", "mysql", "DB_INIT_ENABLED", "yes")));
        expectFailure(
            () -> SchemaInitializer.run(Map.of("DB_TYPE", "mysql", "DB_URL", "jdbc:dm://db")));
    }
    
    private static void checkCanonicalSchemas(Path repository) throws Exception {
        Path plugins = repository.resolve("plugin-default-impl/nacos-default-datasource-plugin");
        for (String type : List.of("mysql", "postgresql", "dm")) {
            String file = switch (type) {
                case "postgresql" -> "pg-schema.sql";
                case "dm" -> "dameng-schema.sql";
                default -> "mysql-schema.sql";
            };
            Path path = plugins.resolve("nacos-datasource-plugin-" + type)
                .resolve("src/main/resources/META-INF/" + file);
            String source = Files.readString(path);
            if ("postgresql".equals(type)) {
                source = source.replaceAll("(?im)^\\s*DROP TABLE IF EXISTS[^;]*;", "");
            }
            SchemaInitializer.Plan plan = SchemaInitializer.parse(source);
            require(plan.tables().size() == 16, type + " should supply all 16 tables");
            require(plan.tables().containsKey("users") && plan.tables().containsKey("config_info"),
                "Missing core tables");
        }
    }
    
    private static void expectFailure(CheckedTask task) throws Exception {
        try {
            task.run();
            throw new AssertionError("Expected initialization refusal");
        } catch (SchemaInitializer.InitFailure expected) {
            // The reason is safe and never contains the original SQL/credentials.
        }
    }
    
    private static void require(boolean condition, String reason) {
        if (!condition) {
            throw new AssertionError(reason);
        }
    }
    
    private interface CheckedTask {
        
        void run() throws Exception;
    }
}
