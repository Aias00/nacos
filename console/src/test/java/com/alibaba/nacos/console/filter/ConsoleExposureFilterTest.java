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
import jakarta.servlet.DispatcherType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class ConsoleExposureFilterTest {
    
    private MockEnvironment environment;
    
    private final ConsoleExposureFilter filter = new ConsoleExposureFilter();
    
    @BeforeEach
    void setUp() {
        environment = new MockEnvironment();
        EnvUtil.setEnvironment(environment);
    }
    
    @Test
    void defaultsRetainEveryUiAndNoticeRoute() throws Exception {
        for (String path : new String[] {"/legacy/", "/console-ui/public/js/loader.js",
            "/next/NOTICE", "/next/LICENSE", "/next/THIRD_PARTY_NOTICES.md",
            "/v3/console/server/state"}) {
            check(path, true, DispatcherType.REQUEST);
        }
    }
    
    @Test
    void disabledStateRejectsOnlyTheCanonicalStateEndpoint() throws Exception {
        environment.setProperty("nacos.console.server-state.enabled", "false");
        for (DispatcherType dispatcher : new DispatcherType[] {DispatcherType.REQUEST,
            DispatcherType.FORWARD}) {
            for (String path : new String[] {"/v3/console/server/state",
                "/v3/console/server/state/", "/v3/console/server/state///",
                "/v3/console/server/%73tate", "/v3/console/server/state%2f%2f",
                "/v3//console/server/state", "/v3/console/server/./state",
                "/v3/console/server/state;session=test"}) {
                check(path, false, dispatcher);
            }
        }
        for (String path : new String[] {"/v3/console/server/state-extra",
            "/v3/console/server/state/child", "/v3/console/server/guide",
            "/v3/console/server/announcement", "/v3/console/health/readiness",
            "/v3/auth/user/login", "/v3/console/core/namespace/list",
            "/v3/admin/core/state", "/next/index.html"}) {
            check(path, true, DispatcherType.REQUEST);
        }
    }
    
    @Test
    void disabledLegacyRejectsEntriesAndDirectAssetsWithContextPath() throws Exception {
        environment.setProperty("nacos.console.ui.legacy.enabled", "false");
        for (String path : new String[] {"/legacy", "/legacy/", "/legacy/index.html",
            "/legacy/js/main.js", "/console-ui", "/console-ui/index.html",
            "/console-ui/public/js/loader.js", "//legacy//js/main.js",
            "/next/../legacy/js/main.js", "/%6cegacy/js/main.js",
            "/legacy;session=test/js/main.js", "/console-ui%3bsession=test/index.html",
            "/img/nacos.png", "/img/logo-2000-390.svg", "/img/nacos.png/",
            "/img/nacos.png///", "/img/nacos.png%2f%2f", "/img/logo-2000-390.svg/",
            "/img/logo-2000-390.svg///", "/img/logo-2000-390.svg%2f%2f"}) {
            check(path, false, DispatcherType.REQUEST);
        }
        for (String path : new String[] {"/next/", "/next/assets/index.js", "/legacy-custom/",
            "/v3/console/server/state", "/v3/auth/user/login", "/img/custom.svg",
            "/img/nacos.png.backup", "/next/img/nacos-icon.png", "/img/custom/"}) {
            check(path, true, DispatcherType.REQUEST);
        }
    }
    
    @Test
    void noticeGateIsLimitedToNoticeFilesWithinUiPrefixes() throws Exception {
        environment.setProperty("nacos.console.ui.notices.enabled", "false");
        for (String path : new String[] {"/next/NOTICE", "/next/LICENSE",
            "/next/THIRD_PARTY_NOTICES.md", "/legacy/NOTICE", "/console-ui/NOTICE",
            "/next/public/%4eOTICE", "/next/NOTICE;download=true",
            "/next/assets/../NOTICE", "/next/NOTICE/", "/next/NOTICE///",
            "/next/NOTICE%2f", "/next/NOTICE%2f%2f", "/next/LICENSE/", "/next/LICENSE%2f",
            "/next/THIRD_PARTY_NOTICES.md/", "/next/THIRD_PARTY_NOTICES.md%2f"}) {
            check(path, false, DispatcherType.REQUEST);
        }
        for (String path : new String[] {"/next/", "/legacy/", "/next/assets/index.js",
            "/next/NOTICE.js", "/v3/console/NOTICE", "/other/NOTICE", "/next/assets/"}) {
            check(path, true, DispatcherType.REQUEST);
        }
    }
    
    @Test
    void forwardedRequestsCannotBypassTheSameGates() throws Exception {
        environment.setProperty("nacos.console.ui.legacy.enabled", "false");
        environment.setProperty("nacos.console.ui.notices.enabled", "false");
        check("/legacy/index.html", false, DispatcherType.FORWARD);
        check("/next/NOTICE", false, DispatcherType.FORWARD);
        check("/next/index.html", true, DispatcherType.FORWARD);
    }
    
    private void check(String path, boolean permitted, DispatcherType dispatcher) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/control" + path);
        request.setContextPath("/control");
        request.setDispatcherType(dispatcher);
        request.addHeader("Authorization", "Bearer ignored-for-static-policy");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(request, response, chain);
        if (permitted) {
            assertNotNull(chain.getRequest(), path);
        } else {
            assertNull(chain.getRequest(), path);
            assertEquals(404, response.getStatus(), path);
            assertEquals("", response.getContentAsString(), path);
        }
    }
}
