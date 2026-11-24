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
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.PreparedStatement;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.sql.Statement;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

/** Opt-in real JDBC tests; exclusively uses a caller-provisioned disposable schema. */
public final class SchemaInitializerJdbcTest {
    
    private SchemaInitializerJdbcTest() {
    }
    
    public static void main(String[] args) throws Exception {
        Map<String, String> environment = new HashMap<>(System.getenv());
        String url = required(environment, "DB_URL");
        String user = required(environment, "DB_USER");
        String password = required(environment, "DB_PASSWORD");
        String type = required(environment, "DB_TYPE");
        if (!"true".equals(environment.get("CF_SCHEMA_TEST_DISPOSABLE"))) {
            throw new IllegalArgumentException(
                "Explicit CF_SCHEMA_TEST_DISPOSABLE=true is required");
        }
        Path schema = Path.of(environment.get("NACOS_HOME"), "conf", switch (type) {
            case "mysql" -> "mysql-schema.sql";
            case "postgresql" -> "pg-schema.sql";
            default -> "dameng-schema.sql";
        });
        SchemaInitializer.Plan plan = SchemaInitializer.parse(Files.readString(schema));
        try (Connection connection = DriverManager.getConnection(url, user, password)) {
            String first = plan.definitions().get(0).sql();
            try (Statement statement = connection.createStatement()) {
                statement.execute(first);
                statement.execute(
                    "CREATE TABLE cf_preserve_marker (id INTEGER PRIMARY KEY, marker_value VARCHAR(64))");
                statement.execute(
                    "INSERT INTO cf_preserve_marker (id,marker_value) VALUES (1,'keep me')");
            }
        }
        // Two first startups see a partial schema and must serialize their missing DDL.
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread[] initializers = new Thread[2];
        for (int i = 0; i < initializers.length; i++) {
            initializers[i] = new Thread(() -> {
                ready.countDown();
                try {
                    start.await();
                    SchemaInitializer.run(environment);
                } catch (Throwable error) {
                    failure.compareAndSet(null, error);
                }
            });
            initializers[i].start();
        }
        ready.await();
        start.countDown();
        for (Thread initializer : initializers) {
            initializer.join(90000);
            require(!initializer.isAlive(), "Concurrent initialization did not finish");
        }
        if (failure.get() != null) {
            throw new AssertionError("Concurrent initialization failed", failure.get());
        }
        SchemaInitializer.run(environment);
        try (Connection connection = DriverManager.getConnection(url, user, password);
            Statement statement = connection.createStatement();
            ResultSet result =
                statement.executeQuery("SELECT marker_value FROM cf_preserve_marker WHERE id=1")) {
            require(result.next() && "keep me".equals(result.getString(1)),
                "Repeated startup changed existing data");
        }
        checkLockTimeout(environment, url, user, password, type);
        Map<String, String> wrongSchema = new HashMap<>(environment);
        wrongSchema.put("DB_SCHEMA", "not_the_selected_schema");
        try {
            SchemaInitializer.run(wrongSchema);
            throw new AssertionError("Wrong DB_SCHEMA was accepted");
        } catch (SchemaInitializer.InitFailure expected) {
            require(expected.getMessage().contains("DB_SCHEMA"), "Wrong schema error");
        }
        // Existing narrow text storage must not pass merely because the JDBC type is VARCHAR.
        try (Connection connection = DriverManager.getConnection(url, user, password);
            Statement statement = connection.createStatement()) {
            String alter = "postgresql".equals(type)
                ? "ALTER TABLE config_info ALTER COLUMN content TYPE VARCHAR(1)"
                : "ALTER TABLE config_info MODIFY content VARCHAR(1)";
            statement.execute(alter);
        }
        expectIncompatible(environment);
        // An incompatible existing table must stop startup, never silently alter it.
        try (Connection connection = DriverManager.getConnection(url, user, password);
            Statement statement = connection.createStatement()) {
            statement.execute("ALTER TABLE config_info ADD cf_existing_marker INTEGER");
            statement.execute("ALTER TABLE config_info DROP COLUMN content");
        }
        expectIncompatible(environment);
        System.out.println(
            "JDBC initializer tests passed: partial schema, concurrent startup, restart preservation, incompatible-schema refusal ("
                + type + ")");
    }
    
    private static void checkLockTimeout(Map<String, String> environment, String url,
        String user, String password, String type) throws Exception {
        if ("dm".equals(type)) {
            return;
        }
        try (Connection blocker = DriverManager.getConnection(url, user, password)) {
            String sql;
            String name;
            if ("mysql".equals(type)) {
                sql = "SELECT GET_LOCK(?, 1)";
                name = "cf-server-schema-init:" + UUID.nameUUIDFromBytes(
                    blocker.getCatalog().getBytes(StandardCharsets.UTF_8));
            } else {
                sql = "SELECT pg_advisory_lock(1185943169, hashtext(?))";
                name = blocker.getSchema();
            }
            try (PreparedStatement lock = blocker.prepareStatement(sql)) {
                lock.setString(1, name);
                lock.execute();
            }
            Map<String, String> timed = new HashMap<>(environment);
            timed.put("DB_INIT_LOCK_TIMEOUT", "1");
            try {
                SchemaInitializer.run(timed);
                throw new AssertionError("Contended lock did not refuse startup");
            } catch (SchemaInitializer.InitFailure expected) {
                require(expected.getMessage().contains("lock"), "Wrong lock error");
            }
        }
    }
    
    private static void expectIncompatible(Map<String, String> environment) throws Exception {
        try {
            SchemaInitializer.run(environment);
            throw new AssertionError("Missing or undersized content column did not fail startup");
        } catch (SchemaInitializer.InitFailure expected) {
            require(expected.getMessage().contains("config_info.content"),
                "Wrong compatibility error");
        }
    }
    
    private static String required(Map<String, String> environment, String name) {
        String value = environment.get(name);
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException("Missing test environment " + name);
        }
        return value;
    }
    
    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
