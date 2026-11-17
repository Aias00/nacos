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

package com.alibaba.nacos.test.consoleapi.core;

import com.alibaba.nacos.api.model.v2.ErrorCode;
import com.alibaba.nacos.common.utils.JacksonUtils;
import com.alibaba.nacos.test.consoleapi.ConsoleApiBaseITCase;
import com.fasterxml.jackson.databind.JsonNode;
import org.apache.hc.client5.http.classic.methods.HttpPost;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * External HTTP checks for optional Console exposure controls.
 *
 * <p>Scenario coverage: default state and UI behavior remain compatible; a separately configured
 * reduced-exposure deployment optionally projects or closes state, blocks direct Legacy assets
 * and optional notice URLs, and returns neutral framework errors without changing typed API failures.
 * Expectations are test properties, not runtime configuration writes. Unexpected internal failures
 * and path canonicalization boundaries are covered by Console unit tests rather than fault injection.
 *
 * @author nacos
 */
public class ConsoleExposureITCase extends ConsoleApiBaseITCase {

    private static final Set<String> BOOTSTRAP_FIELDS = Set.of("auth_enabled", "auth_admin_request",
            "login_page_enabled", "console_ui_enabled", "console_ui_default", "function_mode",
            "ai_enabled", "copilot_enabled", "auth_system_type");

    @Test
    public void testAnonymousStateMatchesConfiguredProjection() throws Exception {
        boolean minimal = expected("server-state.minimal", false);
        HttpResponse response = getRaw(consolePath("/v3/console/server/state?version=requested"
                + "&auth_system_type=requested"), AuthIdentity.ANONYMOUS);
        if (!expected("server-state.enabled", true)) {
            assertClosedState(response);
            for (String path : new String[] {"/v3/console/server/state/",
                    "/v3/console/server/%73tate"}) {
                assertClosedState(getRaw(consolePath(path), AuthIdentity.ANONYMOUS));
            }
            assertRejectedStatePath(getRaw(consolePath(
                    "/v3/console/server/state//?unexpected=ignored"), AuthIdentity.ANONYMOUS));
            assertClosedState(getRaw(consolePath("/v3/console/server/state"), AuthIdentity.INVALID));
            assertClosedState(executeRaw(new HttpPost(requestUrl(
                    consolePath("/v3/console/server/state"))), AuthIdentity.INVALID));
            if (AUTH_ENABLED) {
                assertClosedState(getRaw(consolePath("/v3/console/server/state"), AuthIdentity.ADMIN));
            }
            return;
        }
        assertEquals(200, response.code(), response.body());
        JsonNode state = JacksonUtils.toObj(response.body());
        assertTrue(state.isObject(), response.body());
        for (String field : new String[] {"auth_enabled", "login_page_enabled",
                "console_ui_enabled", "ai_enabled", "copilot_enabled"}) {
            assertTrue(state.has(field), field + ": " + response.body());
        }
        String authType = System.getProperty("nacos.test.console.auth-system-type", "nacos");
        assertEquals(minimal && "nacos".equalsIgnoreCase(authType) ? "local" : authType,
                state.path("auth_system_type").asText(), response.body());
        if (minimal) {
            state.fieldNames().forEachRemaining(field ->
                    assertTrue(BOOTSTRAP_FIELDS.contains(field), response.body()));
            for (String field : new String[] {"version", "server_port", "startup_mode",
                    "datasource_platform", "defaultMaxSize"}) {
                assertFalse(state.has(field), field + ": " + response.body());
            }
        } else {
            assertFalse(state.path("version").asText().isEmpty(), response.body());
            assertFalse(state.path("server_port").asText().isEmpty(), response.body());
        }
    }

    @Test
    public void testLegacyAssetsCannotBypassDisabledEntries() throws Exception {
        boolean enabled = expected("ui.legacy.enabled", true);
        for (String path : new String[] {"/legacy/js/main.js", "/legacy/css/main.css",
                "/legacy/img/favicon.ico", "/legacy/js/main.js?cache=ignored",
                "/console-ui/public/js/jquery.js",
                "/img/nacos.png", "/img/logo-2000-390.svg"}) {
            HttpResponse response = getRaw(consolePath(path), AuthIdentity.ANONYMOUS);
            assertEquals(enabled ? 200 : 404, response.code(), path + ": " + response.body());
            if (enabled) {
                assertFalse(response.body().isEmpty(), path);
            } else {
                assertEquals("", response.body(), path);
            }
        }
    }

    @Test
    @EnabledIfSystemProperty(named = "nacos.test.console.notices.present", matches = "true")
    public void testPackagedNoticeUrlsFollowConfiguredVisibility() throws Exception {
        boolean enabled = expected("ui.notices.enabled", true);
        for (String path : new String[] {"/next/NOTICE", "/next/NOTICE/", "/next/LICENSE",
                "/next/LICENSE/", "/next/THIRD_PARTY_NOTICES.md", "/next/THIRD_PARTY_NOTICES.md/"}) {
            HttpResponse response = getRaw(consolePath(path), AuthIdentity.ANONYMOUS);
            assertEquals(enabled ? 200 : 404, response.code(), path + ": " + response.body());
            if (enabled) {
                assertFalse(response.body().isEmpty(), path);
            } else {
                assertEquals("", response.body(), path);
            }
        }
    }

    @Test
    public void testFrameworkErrorsFollowConfiguredDetailPolicy() throws Exception {
        boolean details = expected("error.details.enabled", true);
        HttpResponse missing = getRaw(consolePath("/openapi-it-missing-console-resource"),
                AuthIdentity.ANONYMOUS);
        HttpResponse method = executeRaw(new HttpPost(requestUrl(consolePath("/next/index.html"))),
                AuthIdentity.ANONYMOUS);
        if (details) {
            assertEquals(500, missing.code(), missing.body());
            assertEquals(500, method.code(), method.body());
            assertTrue(missing.body().contains("caused:"), missing.body());
            assertTrue(method.body().contains("caused:"), method.body());
        } else {
            assertNeutralError(missing, 404, "Not Found");
            assertNeutralError(method, 405, "Method Not Allowed");
        }
    }

    @Test
    public void testTypedApiValidationRemainsUnchanged() throws Exception {
        HttpResponse response = getRaw(consolePath(
                "/v3/console/server/announcement?language=fr-FR"), AuthIdentity.ANONYMOUS);
        assertEquals(200, response.code(), response.body());
        JsonNode root = JacksonUtils.toObj(response.body());
        assertEquals(ErrorCode.SERVER_ERROR.getCode(), root.path("code").asInt(), response.body());
        assertTrue(root.path("message").asText().contains("Unsupported language"), response.body());
    }

    private void assertNeutralError(HttpResponse response, int status, String message) {
        assertEquals(status, response.code(), response.body());
        JsonNode body = JacksonUtils.toObj(response.body());
        assertEquals(status, body.path("code").asInt(), response.body());
        assertEquals(message, body.path("message").asText(), response.body());
        assertFalse(response.body().contains("caused:"), response.body());
        assertFalse(response.body().contains("com.alibaba"), response.body());
        assertFalse(response.body().contains("/next/"), response.body());
        assertFalse(response.body().contains("openapi-it-missing"), response.body());
    }

    private void assertClosedState(HttpResponse response) {
        assertEquals(404, response.code(), response.body());
        assertEquals("", response.body());
    }

    private void assertRejectedStatePath(HttpResponse response) {
        if (response.code() == 400) {
            String body = response.body().toLowerCase(java.util.Locale.ROOT);
            for (String field : new String[] {"version", "auth_system_type", "auth_enabled",
                    "server_port", "startup_mode", "datasource_platform", "ai_enabled",
                    "copilot_enabled"}) {
                assertFalse(body.contains(field), response.body());
            }
        } else {
            assertClosedState(response);
        }
    }

    private boolean expected(String setting, boolean defaultValue) {
        return Boolean.parseBoolean(System.getProperty("nacos.test.console." + setting,
                Boolean.toString(defaultValue)));
    }

    private String consolePath(String path) {
        return System.getProperty("nacos.test.console.context-path", "") + path;
    }
}
