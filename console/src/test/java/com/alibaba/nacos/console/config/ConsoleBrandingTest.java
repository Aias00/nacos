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

package com.alibaba.nacos.console.config;

import com.alibaba.nacos.common.utils.JacksonUtils;
import com.alibaba.nacos.sys.env.EnvUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConsoleBrandingTest {
    
    private static final String HTML = "<html><head><title>Nacos Console</title>"
        + "<link rel=\"shortcut icon\" href=\"img/nacos.png\" />"
        + "</head><body><script src=\"js/main.js\"></script></body></html>";
    
    private MockEnvironment environment;
    
    @BeforeEach
    void setUp() {
        environment = new MockEnvironment();
        EnvUtil.setEnvironment(environment);
    }
    
    @Test
    void unconfiguredEntryRemainsByteForByteUnchanged() {
        assertEquals(HTML, ConsoleBranding.apply(HTML));
    }
    
    @Test
    void configuresTitleImagesAndVersionWithoutChangingApplicationScript() {
        environment.setProperty("nacos.console.brand.name", "Service Console");
        environment.setProperty("nacos.console.brand.logo", "/console/branding/logo.svg");
        environment.setProperty("nacos.console.brand.favicon",
            "https://example.com/icon.svg?a=1&b=2");
        environment.setProperty("nacos.console.brand.show-version", "false");
        String html = ConsoleBranding.apply(HTML);
        assertTrue(html.contains("<title>Service Console</title>"));
        assertTrue(html.contains("href=\"https://example.com/icon.svg?a=1&amp;b=2\""));
        assertTrue(html.contains("<script src=\"js/main.js\"></script>"));
        Map<?, ?> brand = branding(html);
        assertEquals("Service Console", brand.get("name"));
        assertEquals("/console/branding/logo.svg", brand.get("logo"));
        assertEquals(Boolean.FALSE, brand.get("showVersion"));
    }
    
    @Test
    void escapesHtmlAndScriptClosingTagsWithoutChangingConfiguredText() {
        String name = "研发 $1 </script><img src=x onerror=alert(1)> & \"Ops\"";
        environment.setProperty("nacos.console.brand.name", name);
        String html = ConsoleBranding.apply(HTML);
        assertFalse(html.contains("<img"));
        assertTrue(html.contains("&lt;/script&gt;"));
        assertTrue(html.contains("\\u003c/script\\u003e"));
        assertEquals(name, branding(html).get("name"));
    }
    
    @Test
    void unsafeOrMalformedImageUrlsRetainOriginalAssets() {
        for (String value : new String[] {"javascript:alert(1)", "data:image/svg+xml,test",
            "//example.com/icon.svg", "\\\\example.com\\icon.svg", "bad url"}) {
            environment.setProperty("nacos.console.brand.logo", value);
            environment.setProperty("nacos.console.brand.favicon", value);
            assertEquals(HTML, ConsoleBranding.apply(HTML), value);
        }
    }
    
    @Test
    void acceptsRelativeImageUrls() {
        environment.setProperty("nacos.console.brand.logo", "../img/custom.svg");
        environment.setProperty("nacos.console.brand.show-version", "false");
        Map<?, ?> brand = branding(ConsoleBranding.apply(HTML));
        assertEquals("../img/custom.svg", brand.get("logo"));
    }
    
    private Map<?, ?> branding(String html) {
        String start = "<script id=\"console-branding\" type=\"application/json\">";
        int offset = html.indexOf(start) + start.length();
        return JacksonUtils.toObj(html.substring(offset, html.indexOf("</script>", offset)),
            Map.class);
    }
}
