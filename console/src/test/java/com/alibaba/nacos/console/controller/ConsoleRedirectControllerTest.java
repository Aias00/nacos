/*
 * Copyright 1999-2024 Alibaba Group Holding Ltd.
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

package com.alibaba.nacos.console.controller;

import com.alibaba.nacos.sys.env.EnvUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.core.io.ClassPathResource;

import java.nio.charset.StandardCharsets;

import static org.mockito.Mockito.mockStatic;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.hamcrest.Matchers.containsString;

@ExtendWith(MockitoExtension.class)
class ConsoleRedirectControllerTest {
    
    private MockMvc mockMvc;
    
    private MockedStatic<EnvUtil> mockedEnvUtil;
    
    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new ConsoleRedirectController()).build();
        mockedEnvUtil = mockStatic(EnvUtil.class);
    }
    
    @AfterEach
    void tearDown() {
        mockedEnvUtil.close();
    }
    
    @Test
    void testLegacyResourcesAreNotPackaged() throws Exception {
        for (String path : new String[] {"index.html", "js/main.js", "css/main.css"}) {
            assertFalse(new ClassPathResource("static/legacy/" + path).exists(), path);
        }
        mockMvc.perform(get("/legacy/index.html")).andExpect(status().isNotFound());
    }
    
    @Test
    void testIndexRedirectsToNextByDefault() throws Exception {
        mockedEnvUtil.when(() -> EnvUtil.getProperty("nacos.console.ui.default", "next"))
            .thenReturn("next");
        mockMvc.perform(get("/")).andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/next/"));
    }
    
    @Test
    void testIndexFallsBackToNextWhenLegacyResourcesAreAbsent() throws Exception {
        mockedEnvUtil.when(() -> EnvUtil.getProperty("nacos.console.ui.default", "next"))
            .thenReturn("legacy");
        mockMvc.perform(get("/")).andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/next/"));
    }
    
    @Test
    void testDisabledLegacyDefaultFallsBackToNext() throws Exception {
        mockedEnvUtil.when(() -> EnvUtil.getProperty("nacos.console.ui.default", "next"))
            .thenReturn("legacy");
        mockedEnvUtil.when(() -> EnvUtil.getProperty("nacos.console.ui.legacy.enabled",
            Boolean.class, true)).thenReturn(false);
        mockMvc.perform(get("/")).andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/next/"));
    }
    
    @Test
    void testNextForwardsToIndexHtml() throws Exception {
        mockMvc.perform(get("/next/")).andExpect(status().isOk())
            .andExpect(forwardedUrl("/next/index.html"));
    }
    
    @Test
    void testLegacyForwardsToIndexHtml() throws Exception {
        mockMvc.perform(get("/legacy/")).andExpect(status().isOk())
            .andExpect(forwardedUrl("/legacy/index.html"));
    }
    
    @Test
    void testDefaultIndexResourcesRemainUnchanged() throws Exception {
        for (String ui : new String[] {"next", "console-ui"}) {
            String original = new ClassPathResource("static/" + ui + "/index.html")
                .getContentAsString(StandardCharsets.UTF_8);
            mockMvc.perform(get("/" + ui + "/index.html")).andExpect(status().isOk())
                .andExpect(content().string(original))
                .andExpect(header().string("Cache-Control", "no-store"));
        }
    }
    
    @Test
    void testBrandingIsAvailableInNextEntryWithConsoleContextPath() throws Exception {
        mockedEnvUtil.when(() -> EnvUtil.getProperty("nacos.console.brand.name", ""))
            .thenReturn("Internal Console");
        for (String ui : new String[] {"next"}) {
            mockMvc.perform(get("/console/" + ui + "/index.html").contextPath("/console"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("<title>Internal Console</title>")))
                .andExpect(content().string(containsString("type=\"application/json\"")));
        }
    }
    
    @Test
    void testHistoricalEntryRedirectsToConfiguredUiWhenBranded() throws Exception {
        mockedEnvUtil.when(() -> EnvUtil.getProperty("nacos.console.brand.name", ""))
            .thenReturn("Internal Console");
        for (String ui : new String[] {"next", "legacy"}) {
            mockedEnvUtil.when(() -> EnvUtil.getProperty("nacos.console.ui.default", "next"))
                .thenReturn(ui);
            for (String path : new String[] {"/console-ui/", "/console-ui/index.html"}) {
                mockMvc.perform(get("/console" + path).contextPath("/console"))
                    .andExpect(status().isFound())
                    .andExpect(redirectedUrl("/console/next/"));
            }
        }
    }
}
