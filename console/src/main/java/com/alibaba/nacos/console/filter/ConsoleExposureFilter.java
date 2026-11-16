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

package com.alibaba.nacos.console.filter;

import com.alibaba.nacos.sys.env.EnvUtil;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.GenericFilterBean;
import org.springframework.web.util.UriUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;

/**
 * Optional Console-only restrictions on the state endpoint, historical UI and notice URLs.
 *
 * @author nacos
 */
public class ConsoleExposureFilter extends GenericFilterBean {
    
    private static final Set<String> NOTICES =
        Set.of("notice", "license", "third_party_notices.md");
    
    private static final Set<String> LEGACY_IMAGES =
        Set.of("/img/nacos.png", "/img/logo-2000-390.svg");
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
        throws IOException, ServletException {
        boolean legacyEnabled = !Boolean.FALSE.equals(EnvUtil.getProperty(
            "nacos.console.ui.legacy.enabled", Boolean.class, true));
        boolean noticesEnabled = !Boolean.FALSE.equals(EnvUtil.getProperty(
            "nacos.console.ui.notices.enabled", Boolean.class, true));
        boolean stateEnabled = !Boolean.FALSE.equals(EnvUtil.getProperty(
            "nacos.console.server-state.enabled", Boolean.class, true));
        if (!legacyEnabled || !noticesEnabled || !stateEnabled) {
            String path = path((HttpServletRequest) request);
            boolean state = "/v3/console/server/state".equals(path);
            boolean historical = under(path, "/legacy") || under(path, "/console-ui")
                || LEGACY_IMAGES.contains(path);
            boolean notice = (historical || under(path, "/next"))
                && NOTICES.contains(path.substring(path.lastIndexOf('/') + 1));
            if ((!stateEnabled && state) || (!legacyEnabled && historical)
                || (!noticesEnabled && notice)) {
                ((HttpServletResponse) response).setStatus(HttpServletResponse.SC_NOT_FOUND);
                return;
            }
        }
        chain.doFilter(request, response);
    }
    
    private String path(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        try {
            path = UriUtils.decode(path, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ignored) {
            // The container retains responsibility for malformed request paths.
        }
        path = path.replace('\\', '/').replaceAll(";[^/]*", "").replaceAll("/{2,}", "/");
        path = StringUtils.cleanPath(path).toLowerCase(Locale.ROOT);
        return path.length() > 1 && path.endsWith("/") ? path.substring(0, path.length() - 1)
            : path;
    }
    
    private boolean under(String path, String prefix) {
        return path.equals(prefix) || path.startsWith(prefix + '/');
    }
}
