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

import com.alibaba.nacos.common.utils.JacksonUtils;
import com.alibaba.nacos.test.consoleapi.ConsoleApiBaseITCase;
import com.fasterxml.jackson.databind.JsonNode;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Standalone HTTP checks for Console presentation configuration.
 *
 * <p>Scenario coverage: existing directory and index entries remain anonymous HTML in both UIs;
 * optional expected settings verify deployed branding without changing server configuration.
 * Missing/unsafe settings and HTML escaping are covered by focused Console unit tests.
 * The merged-only root hint check requires an explicitly selected deployment profile.
 * SDK health and public state contracts remain covered by CoreStateAdminApiOpenApiITCase.
 *
 * @author nacos
 */
public class ConsolePresentationITCase extends ConsoleApiBaseITCase {

    private static final Pattern BRAND = Pattern.compile(
        "<script id=\"console-branding\" type=\"application/json\">(.*?)</script>", Pattern.DOTALL);

    @Test
    public void testDirectoryAndIndexEntriesForBothUis() throws Exception {
        String context = System.getProperty("nacos.test.console.context-path", "");
        String name = System.getProperty("nacos.test.brand.name", "");
        String logo = System.getProperty("nacos.test.brand.logo", "");
        String favicon = System.getProperty("nacos.test.brand.favicon", "");
        boolean showVersion = Boolean.parseBoolean(
            System.getProperty("nacos.test.brand.show-version", "true"));
        for (String path : new String[] {"/next/", "/next/index.html", "/legacy/", "/legacy/index.html",
            "/console-ui/", "/console-ui/index.html"}) {
            HttpResponse response = getRaw(context + path, AuthIdentity.ANONYMOUS);
            assertEquals(200, response.code(), path + ": " + response.body());
            assertTrue(response.body().contains("<title>"), path);
            assertTrue(response.body().contains("id=\"root\""), path);
            Matcher matcher = BRAND.matcher(response.body());
            if (name.isEmpty() && logo.isEmpty() && favicon.isEmpty() && showVersion) {
                assertFalse(matcher.find(), path);
            } else {
                assertTrue(matcher.find(), path);
                JsonNode brand = JacksonUtils.toObj(matcher.group(1));
                assertEquals(name, brand.path("name").asText(""), path);
                assertEquals(logo, brand.path("logo").asText(""), path);
                assertEquals(favicon, brand.path("favicon").asText(""), path);
                assertEquals(showVersion, brand.path("showVersion").asBoolean(true), path);
            }
        }
    }

    @Test
    @EnabledIfSystemProperty(named = "nacos.test.presentation.merged", matches = "true")
    public void testMergedServerHintConfiguration() throws Exception {
        boolean enabled = Boolean.parseBoolean(
            System.getProperty("nacos.test.console-tip.enabled", "true"));
        String expected = System.getProperty("nacos.test.console-tip.message", "");
        String context = System.getProperty("nacos.test.server.context-path", "/nacos");
        for (String suffix : new String[] {"/", "/index.html"}) {
            HttpResponse response = executeRaw(new HttpGet(BASE_URL + context + suffix), AuthIdentity.ANONYMOUS);
            assertEquals(enabled ? 200 : 404, response.code(), response.body());
            if (!enabled) {
                assertEquals("", response.body());
            } else if (!expected.isEmpty()) {
                assertEquals(expected, response.body());
            } else {
                assertTrue(response.body().contains("Nacos Console default port is"));
            }
        }
    }
}
