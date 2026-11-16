/*
 * Copyright 1999-2025 Alibaba Group Holding Ltd.
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

package com.alibaba.nacos.core.controller.v3;

import com.alibaba.nacos.api.model.v2.Result;
import com.alibaba.nacos.core.cluster.health.ModuleHealthCheckerHolder;
import com.alibaba.nacos.core.cluster.health.ReadinessResult;
import com.alibaba.nacos.core.service.NacosServerStateService;
import com.alibaba.nacos.sys.env.EnvUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpMethod;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link ServerStateController} unit test.
 *
 * @author xiweng.yy
 */
@ExtendWith(MockitoExtension.class)
class ServerStateControllerTest {
    
    @Mock
    private NacosServerStateService stateService;
    
    private MockedStatic<ModuleHealthCheckerHolder> holderMockedStatic;
    
    @Mock
    private ModuleHealthCheckerHolder holder;
    
    private ServerStateController serverStateController;
    
    private MockEnvironment environment;
    
    private ConfigurableEnvironment originalEnvironment;
    
    @BeforeEach
    void setUp() {
        originalEnvironment = EnvUtil.getEnvironment();
        environment = new MockEnvironment();
        EnvUtil.setEnvironment(environment);
        serverStateController = new ServerStateController(stateService);
        holderMockedStatic = Mockito.mockStatic(ModuleHealthCheckerHolder.class);
        holderMockedStatic.when(ModuleHealthCheckerHolder::getInstance).thenReturn(holder);
    }
    
    @AfterEach
    void tearDown() {
        if (holderMockedStatic != null) {
            holderMockedStatic.close();
        }
        EnvUtil.setEnvironment(originalEnvironment);
    }
    
    @Test
    void testServerState() {
        Map<String, String> state = Collections.singletonMap("key", "value");
        when(stateService.getServerState()).thenReturn(state);
        
        ResponseEntity<Result<Map<String, String>>> response = serverStateController.serverState();
        assertEquals(200, response.getStatusCode().value());
        Result<Map<String, String>> result = response.getBody();
        
        assertNotNull(result);
        assertEquals(0, result.getCode().intValue());
        assertEquals(state, result.getData());
    }
    
    @Test
    void testDisabledStateDoesNotReadInternalState() {
        environment.setProperty("nacos.server.admin-state.enabled", "false");
        ResponseEntity<Result<Map<String, String>>> response = serverStateController.serverState();
        assertEquals(404, response.getStatusCode().value());
        assertNull(response.getBody());
        verifyNoInteractions(stateService);
    }
    
    @Test
    void testDisabledHttpStateCannotBeEnabledByRequest() throws Exception {
        environment.setProperty("nacos.server.admin-state.enabled", "false");
        MockMvc mvc = MockMvcBuilders.standaloneSetup(serverStateController).build();
        for (String method : new String[] {"GET", "HEAD"}) {
            MockHttpServletResponse response = mvc.perform(MockMvcRequestBuilders.request(
                HttpMethod.valueOf(method), "/v3/admin/core/state")
                .queryParam("enabled", "true").header("Authorization", "Bearer ignored"))
                .andReturn().getResponse();
            assertEquals(404, response.getStatus());
            assertEquals("", response.getContentAsString());
        }
        verifyNoInteractions(stateService);
    }
    
    @Test
    void testDisablingFullStatePreservesHealth() throws Exception {
        environment.setProperty("nacos.server.admin-state.enabled", "false");
        when(holder.checkReadiness()).thenReturn(new ReadinessResult(true, "OK"));
        assertEquals("ok", serverStateController.liveness().getData());
        assertEquals("ok", serverStateController.readiness().getData());
        verifyNoInteractions(stateService);
    }
    
    @Test
    void testLiveness() {
        Result<String> result = serverStateController.liveness();
        
        assertNotNull(result);
        assertEquals(0, result.getCode().intValue());
        assertEquals("ok", result.getData());
    }
    
    @Test
    void testReadinessSuccess() throws Exception {
        when(holder.checkReadiness()).thenReturn(new ReadinessResult(true, "OK"));
        
        Result<String> result = serverStateController.readiness();
        
        assertNotNull(result);
        assertEquals(0, result.getCode().intValue());
        assertEquals("ok", result.getData());
    }
    
    @Test
    void testReadinessFailure() throws Exception {
        when(holder.checkReadiness())
            .thenReturn(new ReadinessResult(false, "module1 not in readiness"));
        
        Result<String> result = serverStateController.readiness();
        
        assertNotNull(result);
        assertEquals(30000, result.getCode().intValue());
        assertEquals("module1 not in readiness", result.getMessage());
    }
}
