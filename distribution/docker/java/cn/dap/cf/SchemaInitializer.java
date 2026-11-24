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
package cn.dap.cf;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Initializes only missing objects in the container's selected external database.
 *
 * <p>This is a fresh-schema initializer, not a schema migration engine. Existing
 * tables must already have compatible columns and inline keys. It never executes
 * data mutation, DROP, database/user creation or upgrades.
 */
public final class SchemaInitializer {
    
    private static final String IDENTIFIER =
        "(?:[A-Za-z_][A-Za-z0-9_]*|\"[A-Za-z_][A-Za-z0-9_]*\"|`[A-Za-z_][A-Za-z0-9_]*`)";
    private static final Pattern TABLE =
        Pattern.compile("(?is)^CREATE\\s+TABLE\\s+(" + IDENTIFIER + ")\\s*\\(");
    private static final Pattern INDEX =
        Pattern.compile("(?is)^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(" + IDENTIFIER
            + ")\\s+ON\\s+(" + IDENTIFIER + ")\\s*(?:USING\\s+btree\\s*)?\\(");
    private static final Pattern CONSTRAINT =
        Pattern.compile("(?is)^ALTER\\s+TABLE\\s+(" + IDENTIFIER
            + ")\\s+ADD\\s+CONSTRAINT\\s+(" + IDENTIFIER + ")\\s+(PRIMARY\\s+KEY|UNIQUE)\\s*\\(");
    private static final Pattern COLUMN = Pattern.compile("(?is)^(" + IDENTIFIER
        + ")\\s+([A-Za-z][A-Za-z0-9]*)(?:\\s*\\(\\s*(\\d+)(?:\\s+CHAR)?(?:\\s*,\\s*\\d+)?\\s*\\))?(.*)$");
    private static final Pattern INLINE_KEY =
        Pattern.compile("(?is)^(?:CONSTRAINT\\s+(" + IDENTIFIER
            + ")\\s+)?(PRIMARY\\s+KEY|UNIQUE(?:\\s+(?:KEY|INDEX))?|KEY|INDEX)(?:\\s+(" + IDENTIFIER
            + "))?\\s*\\(");
    private static final Set<String> SUPPORTED_TYPES = Set.of("mysql", "postgresql", "dm", "derby");
    private static final String DM_LOCK_TABLE = "CF_SCHEMA_INIT_LOCK";
    private static final String MYSQL_LOCK = "cf-server-schema-init";
    private static final long PG_LOCK = 4847657033298611841L;
    
    private SchemaInitializer() {
    }
    
    /**
     * Runs initialization using DB_* environment variables without exposing credentials.
     *
     * @param args no arguments are supported
     */
    public static void main(String[] args) {
        try {
            if (args.length != 0) {
                throw new InitFailure("The initializer accepts no command-line arguments");
            }
            run(System.getenv());
        } catch (Exception error) {
            // JDBC exceptions often include URLs or login information: never print their text.
            String detail = error instanceof InitFailure ? error.getMessage()
                : "Database initialization failed (" + error.getClass().getSimpleName() + ")";
            System.err.println("Schema initialization refused: " + detail);
            System.exit(1);
        }
    }
    
    static void run(Map<String, String> environment) throws Exception {
        String type = environment.getOrDefault("DB_TYPE", "derby").toLowerCase(Locale.ROOT);
        if (!SUPPORTED_TYPES.contains(type)) {
            throw new InitFailure("DB_TYPE must be derby, mysql, postgresql or dm");
        }
        boolean enabled = booleanValue(environment.getOrDefault("DB_INIT_ENABLED", "true"));
        if (!enabled || "derby".equals(type)) {
            System.out.println("Schema initialization: "
                + (enabled ? "Derby owns embedded initialization" : "disabled"));
            return;
        }
        String url = required(environment, "DB_URL");
        String prefix = "jdbc:" + ("postgresql".equals(type) ? "postgresql" : type) + ":";
        if (!url.startsWith(prefix)) {
            throw new InitFailure("DB_URL does not match DB_TYPE");
        }
        String user = required(environment, "DB_USER");
        String password = required(environment, "DB_PASSWORD");
        int timeout = positiveInt(environment.getOrDefault("DB_INIT_LOCK_TIMEOUT", "60"));
        String home = environment.getOrDefault("NACOS_HOME", "/opt/nacos");
        String file = switch (type) {
            case "mysql" -> "mysql-schema.sql";
            case "postgresql" -> "pg-schema.sql";
            default -> "dameng-schema.sql";
        };
        Plan plan = parse(Files.readString(Path.of(home, "conf", file)));
        DriverManager.setLoginTimeout(timeout);
        try (Connection connection = DriverManager.getConnection(url, user, password)) {
            connection.setAutoCommit(true);
            Scope scope = Scope.resolve(connection, type, environment.get("DB_SCHEMA"));
            try (InitLock ignored = lock(connection, scope, type, url, user, password, timeout)) {
                int created = apply(connection, scope, plan, timeout);
                System.out.println("Schema initialization complete: " + type + ", "
                    + plan.tables().size() + " tables verified, " + created + " objects created");
            }
        }
    }
    
    private static String required(Map<String, String> environment, String name)
        throws InitFailure {
        String value = environment.get(name);
        if (value == null || value.isEmpty()) {
            throw new InitFailure("Missing required environment variable " + name);
        }
        return value;
    }
    
    private static int positiveInt(String value) throws InitFailure {
        try {
            int result = Integer.parseInt(value);
            if (result < 1 || result > 3600) {
                throw new NumberFormatException();
            }
            return result;
        } catch (NumberFormatException error) {
            throw new InitFailure("DB_INIT_LOCK_TIMEOUT must be between 1 and 3600 seconds");
        }
    }
    
    private static boolean booleanValue(String value) throws InitFailure {
        if (!"true".equalsIgnoreCase(value) && !"false".equalsIgnoreCase(value)) {
            throw new InitFailure("DB_INIT_ENABLED must be true or false");
        }
        return Boolean.parseBoolean(value);
    }
    
    static Plan parse(String source) throws InitFailure {
        List<Definition> definitions = new ArrayList<>();
        Map<String, Definition> tables = new LinkedHashMap<>();
        for (String sql : splitSql(source)) {
            Matcher table = TABLE.matcher(sql);
            Matcher index = INDEX.matcher(sql);
            Matcher constraint = CONSTRAINT.matcher(sql);
            if (table.find()) {
                String name = identifier(table.group(1));
                int open = table.end() - 1;
                int close = closingParenthesis(sql, open);
                List<Column> columns = new ArrayList<>();
                List<Key> keys = new ArrayList<>();
                for (String part : splitTopLevel(sql.substring(open + 1, close))) {
                    Matcher inlineKey = INLINE_KEY.matcher(part);
                    if (inlineKey.find()) {
                        String kind =
                            inlineKey.group(2).replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
                        keys.add(new Key(null, kind.startsWith("PRIMARY"),
                            kind.startsWith("PRIMARY")
                                || kind.startsWith("UNIQUE"),
                            keyColumns(part, inlineKey.end() - 1)));
                    } else {
                        Matcher column = COLUMN.matcher(part);
                        if (!column.matches()) {
                            throw new InitFailure("Unsupported column definition in table " + name);
                        }
                        String columnName = identifier(column.group(1));
                        String sqlType = column.group(2).toLowerCase(Locale.ROOT);
                        int width = column.group(3) == null ? 0 : Integer.parseInt(column.group(3));
                        if (Set.of("clob", "longtext").contains(sqlType)) {
                            width = 1_073_741_824;
                        } else if ("mediumtext".equals(sqlType)) {
                            width = 16_777_215;
                        } else if ("text".equals(sqlType)) {
                            width = 65_535;
                        }
                        columns.add(new Column(columnName, family(sqlType), width));
                        if (column.group(4).matches("(?is).*\\bPRIMARY\\s+KEY\\b.*")) {
                            keys.add(new Key(null, true, true, List.of(columnName)));
                        }
                    }
                }
                if (columns.isEmpty() || tables.containsKey(name)) {
                    throw new InitFailure("Empty or repeated table definition " + name);
                }
                Definition definition = new Definition(Kind.TABLE, name, name, sql, columns, keys);
                definitions.add(definition);
                tables.put(name, definition);
            } else if (index.find()) {
                String name = identifier(index.group(2));
                String tableName = identifier(index.group(3));
                Key key =
                    new Key(name, false, index.group(1) != null, keyColumns(sql, index.end() - 1));
                definitions
                    .add(new Definition(Kind.INDEX, name, tableName, sql, List.of(), List.of(key)));
            } else if (constraint.find()) {
                String name = identifier(constraint.group(2));
                String tableName = identifier(constraint.group(1));
                Key key = new Key(name,
                    constraint.group(3).toUpperCase(Locale.ROOT).startsWith("PRIMARY"), true,
                    keyColumns(sql, constraint.end() - 1));
                definitions.add(
                    new Definition(Kind.CONSTRAINT, name, tableName, sql, List.of(), List.of(key)));
            } else if (sql.matches("(?is)^COMMENT\\s+ON\\s+(?:TABLE|COLUMN)\\s+.*")
                || sql.matches("(?i)^(?:BEGIN|COMMIT)$")) {
                // Documentation and transaction wrappers carry no schema object or user data.
            } else {
                throw new InitFailure(
                    "Unsupported statement in initialization script; only schema creation is allowed");
            }
        }
        if (tables.isEmpty()) {
            throw new InitFailure("Initialization script contains no tables");
        }
        for (Definition definition : definitions) {
            if (!tables.containsKey(definition.table())) {
                throw new InitFailure(
                    "Schema object references an undeclared table " + definition.table());
            }
        }
        return new Plan(List.copyOf(definitions), Map.copyOf(tables));
    }
    
    static List<String> splitSql(String source) throws InitFailure {
        List<String> statements = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        char quote = 0;
        boolean lineComment = false;
        boolean blockComment = false;
        for (int i = 0; i < source.length(); i++) {
            char c = source.charAt(i);
            char next = i + 1 < source.length() ? source.charAt(i + 1) : 0;
            if (lineComment) {
                if (c == '\n') {
                    lineComment = false;
                    current.append(' ');
                }
            } else if (blockComment) {
                if (c == '*' && next == '/') {
                    blockComment = false;
                    current.append(' ');
                    i++;
                }
            } else if (quote != 0) {
                current.append(c);
                if (c == quote) {
                    if (next == quote) {
                        current.append(next);
                        i++;
                    } else {
                        quote = 0;
                    }
                } else if (c == '\\' && quote == '\'' && next != 0) {
                    current.append(next);
                    i++;
                }
            } else if (c == '-' && next == '-') {
                lineComment = true;
                i++;
            } else if (c == '/' && next == '*') {
                blockComment = true;
                i++;
            } else if (c == '\'' || c == '"' || c == '`') {
                quote = c;
                current.append(c);
            } else if (c == ';') {
                addStatement(statements, current);
            } else {
                current.append(c);
            }
        }
        if (quote != 0 || blockComment) {
            throw new InitFailure("Unterminated quote or comment in initialization script");
        }
        addStatement(statements, current);
        return statements;
    }
    
    private static void addStatement(List<String> statements, StringBuilder current) {
        String sql = current.toString().trim();
        if (!sql.isEmpty()) {
            statements.add(sql);
        }
        current.setLength(0);
    }
    
    private static int closingParenthesis(String sql, int open) throws InitFailure {
        int depth = 0;
        char quote = 0;
        for (int i = open; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (quote != 0) {
                if (c == quote) {
                    if (i + 1 < sql.length() && sql.charAt(i + 1) == quote) {
                        i++;
                    } else {
                        quote = 0;
                    }
                } else if (c == '\\' && quote == '\'') {
                    i++;
                }
            } else if (c == '\'' || c == '"' || c == '`') {
                quote = c;
            } else if (c == '(') {
                depth++;
            } else if (c == ')' && --depth == 0) {
                return i;
            }
        }
        throw new InitFailure("Unbalanced parentheses in initialization script");
    }
    
    private static List<String> splitTopLevel(String value) throws InitFailure {
        List<String> result = new ArrayList<>();
        int start = 0;
        char quote = 0;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (quote != 0) {
                if (c == quote) {
                    if (i + 1 < value.length() && value.charAt(i + 1) == quote) {
                        i++;
                    } else {
                        quote = 0;
                    }
                } else if (c == '\\' && quote == '\'') {
                    i++;
                }
            } else if (c == '\'' || c == '"' || c == '`') {
                quote = c;
            } else if (c == '(') {
                i = closingParenthesis(value, i);
            } else if (c == ',') {
                result.add(value.substring(start, i).trim());
                start = i + 1;
            }
        }
        result.add(value.substring(start).trim());
        return result;
    }
    
    private static List<String> keyColumns(String sql, int open) throws InitFailure {
        List<String> columns = new ArrayList<>();
        for (String column : splitTopLevel(
            sql.substring(open + 1, closingParenthesis(sql, open)))) {
            if (!column.matches(IDENTIFIER + "(?:\\s+(?:ASC|DESC))?")) {
                throw new InitFailure("Unsupported index expression in initialization script");
            }
            columns.add(identifier(column.split("\\s+")[0]));
        }
        return List.copyOf(columns);
    }
    
    private static String identifier(String value) {
        return value.replace("\"", "").replace("`", "").toLowerCase(Locale.ROOT);
    }
    
    private static Family family(String sqlType) throws InitFailure {
        return switch (sqlType) {
            case "bigint", "bigserial", "int8" -> Family.BIGINT;
            case "integer", "int", "int4", "smallint", "tinyint" -> Family.INTEGER;
            case "boolean", "bool", "bit" -> Family.BOOLEAN;
            case "number", "numeric", "decimal" -> Family.DECIMAL;
            case "varchar", "char", "nvarchar", "varchar2" -> Family.STRING;
            case "clob", "text", "longtext", "mediumtext" -> Family.TEXT;
            case "timestamp", "datetime", "date" -> Family.TIMESTAMP;
            default -> throw new InitFailure(
                "Unsupported SQL column type in initialization script: " + sqlType);
        };
    }
    
    static boolean compatible(Column expected, int jdbcType, int size) {
        return switch (expected.family()) {
            case BIGINT -> jdbcType == Types.BIGINT || jdbcType == Types.NUMERIC && size >= 19;
            case INTEGER -> Set.of(Types.INTEGER, Types.BIGINT).contains(jdbcType)
                || jdbcType == Types.NUMERIC && size >= 10;
            case DECIMAL ->
                Set.of(Types.NUMERIC, Types.DECIMAL).contains(jdbcType) && size >= expected.width();
            case BOOLEAN -> Set.of(Types.BOOLEAN, Types.BIT, Types.TINYINT).contains(jdbcType);
            case STRING ->
                Set.of(Types.VARCHAR, Types.NVARCHAR, Types.CHAR, Types.NCHAR).contains(jdbcType)
                    && size >= expected.width();
            case TEXT -> Set.of(Types.CLOB, Types.NCLOB).contains(jdbcType)
                || Set.of(Types.LONGVARCHAR, Types.LONGNVARCHAR).contains(jdbcType)
                    && size >= expected.width()
                || jdbcType == Types.VARCHAR && size >= Math.max(1_073_741_824, expected.width());
            case TIMESTAMP ->
                Set.of(Types.TIMESTAMP, Types.TIMESTAMP_WITH_TIMEZONE).contains(jdbcType);
        };
    }
    
    private static int apply(Connection connection, Scope scope, Plan plan, int timeout)
        throws SQLException, InitFailure {
        // Preflight every already-existing table before creating anything else.
        for (Definition table : plan.tables().values()) {
            if (tableExists(connection, scope, table.name())) {
                validateColumns(connection, scope, table);
                validateInlineKeys(connection, scope, table);
            }
        }
        int created = 0;
        for (Definition definition : plan.definitions()) {
            if (definition.kind() == Kind.TABLE) {
                if (!tableExists(connection, scope, definition.name())) {
                    execute(connection, definition.sql(), timeout);
                    created++;
                }
                validateColumns(connection, scope, definition);
                validateInlineKeys(connection, scope, definition);
            } else {
                Key key = definition.keys().get(0);
                Map<String, Key> actual = indexes(connection, scope, definition.table());
                if (key.primary() && actual.values().stream().anyMatch(Key::primary)) {
                    if (actual.values().stream().noneMatch(k -> equivalent(key, k))) {
                        throw new InitFailure(
                            "Incompatible primary key on table " + definition.table());
                    }
                } else if (actual.containsKey(definition.name())) {
                    if (!equivalent(key, actual.get(definition.name()))) {
                        throw new InitFailure("Incompatible index " + definition.name()
                            + " on table " + definition.table());
                    }
                } else {
                    execute(connection, definition.sql(), timeout);
                    created++;
                }
            }
        }
        return created;
    }
    
    private static void execute(Connection connection, String sql, int timeout)
        throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(timeout);
            statement.execute(sql);
        }
    }
    
    private static void validateColumns(Connection connection, Scope scope, Definition definition)
        throws SQLException, InitFailure {
        Map<String, ColumnMetadata> actual = new HashMap<>();
        DatabaseMetaData metadata = connection.getMetaData();
        try (ResultSet columns = metadata.getColumns(scope.catalog(), scope.schema(),
            scope.pattern(metadata, definition.name()), null)) {
            while (columns.next()) {
                if (scope.matches(columns, definition.name())) {
                    actual.put(identifier(columns.getString("COLUMN_NAME")),
                        new ColumnMetadata(columns.getInt("DATA_TYPE"),
                            columns.getInt("COLUMN_SIZE")));
                }
            }
        }
        for (Column column : definition.columns()) {
            ColumnMetadata found = actual.get(column.name());
            if (found == null || !compatible(column, found.type(), found.size())) {
                throw new InitFailure(
                    "Missing or incompatible column " + definition.name() + "." + column.name()
                        + "; apply a reviewed migration before starting");
            }
        }
    }
    
    private static void validateInlineKeys(Connection connection, Scope scope, Definition table)
        throws SQLException, InitFailure {
        if (table.keys().isEmpty()) {
            return;
        }
        Map<String, Key> actual = indexes(connection, scope, table.name());
        for (Key expected : table.keys()) {
            if (actual.values().stream().noneMatch(k -> equivalent(expected, k))) {
                throw new InitFailure("Missing or incompatible inline key on table " + table.name()
                    + "; apply a reviewed migration before starting");
            }
        }
    }
    
    private static boolean equivalent(Key expected, Key actual) {
        return expected.primary() == actual.primary() && expected.unique() == actual.unique()
            && expected.columns().equals(actual.columns());
    }
    
    private static Map<String, Key> indexes(Connection connection, Scope scope, String table)
        throws SQLException {
        Map<String, Key> result = new HashMap<>();
        Map<String, List<String>> columns = new LinkedHashMap<>();
        Map<String, Boolean> unique = new HashMap<>();
        DatabaseMetaData metadata = connection.getMetaData();
        try (ResultSet indexes = metadata.getIndexInfo(scope.catalog(), scope.schema(),
            scope.stored(table), false, false)) {
            while (indexes.next()) {
                String name = indexes.getString("INDEX_NAME");
                String column = indexes.getString("COLUMN_NAME");
                if (name != null && column != null) {
                    String normalized = identifier(name);
                    columns.computeIfAbsent(normalized, ignored -> new ArrayList<>())
                        .add(identifier(column));
                    unique.put(normalized, !indexes.getBoolean("NON_UNIQUE"));
                }
            }
        }
        List<String> primary = new ArrayList<>();
        String primaryName = null;
        try (ResultSet keys =
            metadata.getPrimaryKeys(scope.catalog(), scope.schema(), scope.stored(table))) {
            while (keys.next()) {
                primary.add(identifier(keys.getString("COLUMN_NAME")));
                primaryName = keys.getString("PK_NAME");
            }
        }
        for (Map.Entry<String, List<String>> entry : columns.entrySet()) {
            boolean isPrimary =
                primaryName != null && entry.getKey().equals(identifier(primaryName));
            result.put(entry.getKey(),
                new Key(entry.getKey(), isPrimary, unique.get(entry.getKey()), entry.getValue()));
        }
        if (!primary.isEmpty()) {
            String name = primaryName == null ? "__primary__" : identifier(primaryName);
            result.put(name, new Key(name, true, true, List.copyOf(primary)));
        }
        return result;
    }
    
    private static boolean tableExists(Connection connection, Scope scope, String table)
        throws SQLException {
        DatabaseMetaData metadata = connection.getMetaData();
        try (ResultSet rows =
            metadata.getTables(scope.catalog(), scope.schema(), scope.pattern(metadata, table),
                new String[] {"TABLE"})) {
            while (rows.next()) {
                if (scope.matches(rows, table)) {
                    return true;
                }
            }
        }
        return false;
    }
    
    private static InitLock lock(Connection connection, Scope scope, String type, String url,
        String user,
        String password, int timeout) throws SQLException, InitFailure {
        if ("mysql".equals(type)) {
            try (PreparedStatement query = connection.prepareStatement("SELECT GET_LOCK(?, ?)")) {
                query.setString(1, mysqlLockName(scope.catalog()));
                query.setInt(2, timeout);
                try (ResultSet result = query.executeQuery()) {
                    if (!result.next() || result.getInt(1) != 1) {
                        throw new InitFailure(
                            "Timed out acquiring database schema initialization lock");
                    }
                }
            }
            return () -> {
                try (PreparedStatement query =
                    connection.prepareStatement("SELECT RELEASE_LOCK(?)")) {
                    query.setString(1, mysqlLockName(scope.catalog()));
                    query.execute();
                }
            };
        }
        if ("postgresql".equals(type)) {
            long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeout);
            while (true) {
                try (PreparedStatement query =
                    connection.prepareStatement("SELECT pg_try_advisory_lock(?, hashtext(?))")) {
                    query.setInt(1, (int) PG_LOCK);
                    query.setString(2, scope.schema());
                    try (ResultSet result = query.executeQuery()) {
                        if (result.next() && result.getBoolean(1)) {
                            return () -> {
                                try (PreparedStatement release = connection.prepareStatement(
                                    "SELECT pg_advisory_unlock(?, hashtext(?))")) {
                                    release.setInt(1, (int) PG_LOCK);
                                    release.setString(2, scope.schema());
                                    release.execute();
                                }
                            };
                        }
                    }
                }
                if (System.nanoTime() >= until) {
                    throw new InitFailure(
                        "Timed out acquiring database schema initialization lock");
                }
                pause();
            }
        }
        // Hold DM's row lock on another connection: DM DDL implicitly commits its own connection.
        Scope lockScope = scope;
        if (!tableExists(connection, lockScope, DM_LOCK_TABLE)) {
            try {
                execute(connection, "CREATE TABLE " + DM_LOCK_TABLE + " (id INTEGER PRIMARY KEY)",
                    timeout);
            } catch (SQLException race) {
                if (!tableExists(connection, lockScope, DM_LOCK_TABLE)) {
                    throw race;
                }
            }
        }
        try {
            execute(connection, "INSERT INTO " + DM_LOCK_TABLE + " (id) VALUES (1)", timeout);
        } catch (SQLException race) {
            try (Statement query = connection.createStatement();
                ResultSet result =
                    query.executeQuery("SELECT id FROM " + DM_LOCK_TABLE + " WHERE id = 1")) {
                if (!result.next()) {
                    throw race;
                }
            }
        }
        Connection holder = DriverManager.getConnection(url, user, password);
        try {
            holder.setAutoCommit(false);
            try (Statement query = holder.createStatement()) {
                query.setQueryTimeout(timeout);
                try (ResultSet result = query
                    .executeQuery("SELECT id FROM " + DM_LOCK_TABLE + " WHERE id = 1 FOR UPDATE")) {
                    if (!result.next()) {
                        throw new InitFailure("Database initialization lock row is missing");
                    }
                }
            }
            return () -> {
                try {
                    holder.rollback();
                } finally {
                    holder.close();
                }
            };
        } catch (SQLException | InitFailure error) {
            holder.close();
            throw error;
        }
    }
    
    private static String mysqlLockName(String catalog) {
        // MySQL named locks are limited to 64 characters even when catalog names are not short.
        return MYSQL_LOCK + ":" + java.util.UUID.nameUUIDFromBytes(
            catalog.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    
    private static void pause() throws InitFailure {
        try {
            Thread.sleep(100);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new InitFailure("Interrupted while waiting for database initialization lock");
        }
    }
    
    enum Kind {
        TABLE, INDEX, CONSTRAINT
    }
    
    enum Family {
        BIGINT, INTEGER, BOOLEAN, DECIMAL, STRING, TEXT, TIMESTAMP
    }
    
    record Column(String name, Family family, int width) {
    }
    
    record ColumnMetadata(int type, int size) {
    }
    
    record Key(String name, boolean primary, boolean unique, List<String> columns) {
    }
    
    record Definition(Kind kind, String name, String table, String sql, List<Column> columns,
        List<Key> keys) {
    }
    
    record Plan(List<Definition> definitions, Map<String, Definition> tables) {
    }
    
    record Scope(String catalog, String schema, boolean uppercase) {
        
        static Scope resolve(Connection connection, String type, String assertion)
            throws SQLException, InitFailure {
            String catalog = connection.getCatalog();
            String schema = "mysql".equals(type) ? null : connection.getSchema();
            if ("dm".equals(type) && (schema == null || schema.isBlank())) {
                schema = connection.getMetaData().getUserName();
            }
            String selected = "mysql".equals(type) ? catalog : schema;
            if (selected == null || selected.isBlank()) {
                throw new InitFailure("JDBC connection has no selected database/schema");
            }
            if (assertion != null && !assertion.isBlank() && !selected.equals(assertion)) {
                throw new InitFailure(
                    "DB_SCHEMA does not match the JDBC connection's selected database/schema");
            }
            return new Scope(catalog, schema, "dm".equals(type));
        }
        
        String stored(String identifier) {
            return uppercase ? identifier.toUpperCase(Locale.ROOT)
                : identifier.toLowerCase(Locale.ROOT);
        }
        
        String pattern(DatabaseMetaData metadata, String identifier) throws SQLException {
            String escape = metadata.getSearchStringEscape();
            return stored(identifier).replace(escape, escape + escape).replace("_", escape + "_")
                .replace("%", escape + "%");
        }
        
        boolean matches(ResultSet result, String table) throws SQLException {
            return Objects.equals(result.getString("TABLE_NAME"), stored(table));
        }
    }
    
    @FunctionalInterface
    interface InitLock extends AutoCloseable {
        
        @Override
        void close() throws SQLException;
    }
    
    static final class InitFailure extends Exception {
        
        private static final long serialVersionUID = 1L;
        
        InitFailure(String message) {
            super(message);
        }
    }
}
