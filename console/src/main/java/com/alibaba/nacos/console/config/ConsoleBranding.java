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
import com.alibaba.nacos.common.utils.StringUtils;
import com.alibaba.nacos.sys.env.EnvUtil;
import org.springframework.web.util.HtmlUtils;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deployment-local branding for console HTML entry pages.
 *
 * @author nacos
 */
public final class ConsoleBranding {
    
    private static final String PREFIX = "nacos.console.brand.";
    
    private static final Pattern TITLE = Pattern.compile("<title>.*?</title>",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    
    private static final Pattern FAVICON = Pattern.compile(
        "<link\\b(?=[^>]*\\brel\\s*=\\s*[\"'][^\"']*icon[^\"']*[\"'])[^>]*>",
        Pattern.CASE_INSENSITIVE);
    
    private ConsoleBranding() {
    }
    
    /**
     * Whether a deployment opted into custom presentation.
     *
     * @return true when at least one branding setting is configured
     */
    public static boolean isConfigured() {
        return StringUtils.isNotBlank(EnvUtil.getProperty(PREFIX + "name", ""))
            || StringUtils.isNotBlank(EnvUtil.getProperty(PREFIX + "logo", ""))
            || StringUtils.isNotBlank(EnvUtil.getProperty(PREFIX + "favicon", ""))
            || Boolean.FALSE
                .equals(EnvUtil.getProperty(PREFIX + "show-version", Boolean.class, true));
    }
    
    /**
     * Apply optional branding to an HTML entry without modifying API or runtime state.
     *
     * @param html original console entry HTML
     * @return HTML with escaped presentation data, or the unchanged original when unconfigured
     */
    public static String apply(String html) {
        Map<String, Object> brand = new LinkedHashMap<>();
        String name = EnvUtil.getProperty(PREFIX + "name", "");
        if (StringUtils.isNotBlank(name)) {
            brand.put("name", name);
            html = TITLE.matcher(html).replaceFirst(
                Matcher.quoteReplacement("<title>" + HtmlUtils.htmlEscape(name) + "</title>"));
        }
        String logo = imageUrl(EnvUtil.getProperty(PREFIX + "logo", ""));
        if (!logo.isEmpty()) {
            brand.put("logo", logo);
        }
        String favicon = imageUrl(EnvUtil.getProperty(PREFIX + "favicon", ""));
        if (!favicon.isEmpty()) {
            brand.put("favicon", favicon);
            html = FAVICON.matcher(html).replaceAll(Matcher.quoteReplacement(
                "<link rel=\"icon\" href=\"" + HtmlUtils.htmlEscape(favicon) + "\" />"));
        }
        if (Boolean.FALSE
            .equals(EnvUtil.getProperty(PREFIX + "show-version", Boolean.class, true))) {
            brand.put("showVersion", false);
        }
        if (brand.isEmpty()) {
            return html;
        }
        // JSON is a data block, not an inline script. Escape HTML delimiters before embedding it.
        String json = JacksonUtils.toJson(brand).replace("<", "\\u003c")
            .replace(">", "\\u003e").replace("&", "\\u0026");
        return html.replace("</head>",
            "<script id=\"console-branding\" type=\"application/json\">" + json
                + "</script></head>");
    }
    
    private static String imageUrl(String value) {
        if (StringUtils.isBlank(value) || value.startsWith("//")) {
            return "";
        }
        try {
            URI uri = URI.create(value);
            String scheme = uri.getScheme();
            if (scheme == null || "https".equalsIgnoreCase(scheme)
                || "http".equalsIgnoreCase(scheme)) {
                return value;
            }
        } catch (IllegalArgumentException ignored) {
            // Invalid image settings retain the original UI asset.
        }
        return "";
    }
}
