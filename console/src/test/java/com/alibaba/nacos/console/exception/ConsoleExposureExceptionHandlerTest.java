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

package com.alibaba.nacos.console.exception;

import com.alibaba.nacos.api.exception.runtime.NacosRuntimeException;
import com.alibaba.nacos.plugin.auth.exception.AccessException;
import com.alibaba.nacos.sys.env.EnvUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ConsoleExposureExceptionHandlerTest {
    
    private MockEnvironment environment;
    
    private MockMvc mockMvc;
    
    @BeforeEach
    void setUp() {
        environment = new MockEnvironment();
        EnvUtil.setEnvironment(environment);
        mockMvc = MockMvcBuilders.standaloneSetup(new FailureController())
            .setControllerAdvice(new ConsoleExceptionHandler()).build();
    }
    
    @Test
    void defaultRetainsHistoricalExceptionDetails() throws Exception {
        mockMvc.perform(get("/failure")).andExpect(status().isInternalServerError())
            .andExpect(content().string(containsString("private.internal.Type")));
    }
    
    @Test
    void restrictedFallbackReturnsNeutralStatusAndJson() throws Exception {
        environment.setProperty("nacos.console.error.details.enabled", "false");
        mockMvc.perform(get("/failure")).andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value(500))
            .andExpect(jsonPath("$.message").value("Internal Server Error"))
            .andExpect(jsonPath("$.data").isEmpty());
        mockMvc.perform(post("/failure")).andExpect(status().isMethodNotAllowed())
            .andExpect(jsonPath("$.code").value(405))
            .andExpect(jsonPath("$.message").value("Method Not Allowed"));
        mockMvc.perform(get("/missing-static")).andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value(404))
            .andExpect(jsonPath("$.message").value("Not Found"));
    }
    
    @Test
    void restrictionPreservesAuthenticationAndTypedDomainErrors() throws Exception {
        environment.setProperty("nacos.console.error.details.enabled", "false");
        mockMvc.perform(get("/access")).andExpect(status().isForbidden())
            .andExpect(content().string("token expired!"));
        mockMvc.perform(get("/validation")).andExpect(status().isBadRequest())
            .andExpect(content().string(containsString("invalid resource name")));
        mockMvc.perform(get("/domain")).andExpect(status().isBadRequest())
            .andExpect(content().string(containsString("resource is read-only")));
    }
    
    @RestController
    static class FailureController {
        
        @GetMapping("/failure")
        String failure() {
            throw new IllegalStateException("private.internal.Type stack detail");
        }
        
        @GetMapping("/missing-static")
        String missing() throws NoResourceFoundException {
            throw new NoResourceFoundException(HttpMethod.GET, "private/internal.js",
                "/missing-static");
        }
        
        @GetMapping("/access")
        String access() throws AccessException {
            throw new AccessException("token expired!");
        }
        
        @GetMapping("/validation")
        String validation() {
            throw new IllegalArgumentException("invalid resource name");
        }
        
        @GetMapping("/domain")
        String domain() {
            throw new NacosRuntimeException(400, "resource is read-only");
        }
    }
}
