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

import com.alibaba.nacos.api.annotation.NacosApi;
import com.alibaba.nacos.api.exception.api.NacosApiException;
import com.alibaba.nacos.api.model.v2.ErrorCode;
import com.alibaba.nacos.core.exception.NacosApiExceptionHandler;
import com.alibaba.nacos.plugin.auth.exception.AccessException;
import com.alibaba.nacos.sys.env.EnvUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.FilterType;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ConsoleApiExceptionHandlerTest {
    
    private MockEnvironment environment;
    
    private MockMvc mockMvc;
    
    @BeforeEach
    void setUp() {
        environment = new MockEnvironment();
        EnvUtil.setEnvironment(environment);
        mockMvc = MockMvcBuilders.standaloneSetup(new FailureController())
            .setControllerAdvice(new ConsoleExceptionHandler(), new ConsoleApiExceptionHandler())
            .build();
    }
    
    @Test
    void annotatedApiDefaultsStillDelegateToTheSharedErrorContract() throws Exception {
        mockMvc.perform(get("/api/failure")).andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value(ErrorCode.SERVER_ERROR.getCode()))
            .andExpect(jsonPath("$.message").value("private.internal.Type stack detail"));
        mockMvc.perform(get("/api/data")).andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value(ErrorCode.DATA_ACCESS_ERROR.getCode()))
            .andExpect(jsonPath("$.data").value("private.sql.Driver connection detail"));
    }
    
    @Test
    void annotatedApiSuppressesOnlyUnexpectedAndDataAccessDetails() throws Exception {
        environment.setProperty("nacos.console.error.details.enabled", "false");
        mockMvc.perform(get("/api/failure")).andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value(ErrorCode.SERVER_ERROR.getCode()))
            .andExpect(jsonPath("$.message").value(ErrorCode.SERVER_ERROR.getMsg()))
            .andExpect(jsonPath("$.data").isEmpty());
        for (String path : new String[] {"/api/data", "/api/io"}) {
            mockMvc.perform(get(path)).andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value(ErrorCode.DATA_ACCESS_ERROR.getCode()))
                .andExpect(jsonPath("$.message").value(ErrorCode.DATA_ACCESS_ERROR.getMsg()))
                .andExpect(jsonPath("$.data").isEmpty());
        }
    }
    
    @Test
    void typedRemoteAuthenticationAndValidationErrorsAreUnchanged() throws Exception {
        environment.setProperty("nacos.console.error.details.enabled", "false");
        mockMvc.perform(get("/api/remote")).andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value(47777))
            .andExpect(jsonPath("$.message").value("remote conflict"))
            .andExpect(jsonPath("$.data").value("resource cannot be published"));
        mockMvc.perform(get("/api/access")).andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value(ErrorCode.ACCESS_DENIED.getCode()))
            .andExpect(jsonPath("$.data").value("token expired!"));
        mockMvc.perform(get("/api/validation")).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value(ErrorCode.PARAMETER_VALIDATE_ERROR.getCode()))
            .andExpect(jsonPath("$.data").value("invalid resource name"));
    }
    
    @Test
    void componentScanningAndExplicitRegistrationKeepOneNamedApiAdvice() {
        try (
            AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getDefaultListableBeanFactory().setAllowBeanDefinitionOverriding(false);
            context.register(AdviceConfiguration.class);
            context.refresh();
            assertEquals(1, context.getBeansOfType(NacosApiExceptionHandler.class).size());
            assertInstanceOf(ConsoleApiExceptionHandler.class,
                context.getBean("nacosApiExceptionHandler"));
        }
    }
    
    @Configuration
    @ComponentScan(basePackageClasses = ConsoleApiExceptionHandler.class,
        useDefaultFilters = false,
        includeFilters = @ComponentScan.Filter(type = FilterType.ANNOTATION,
            classes = ControllerAdvice.class))
    static class AdviceConfiguration {
        
        @Bean
        ConsoleApiExceptionHandler nacosApiExceptionHandler() {
            return new ConsoleApiExceptionHandler();
        }
    }
    
    @NacosApi
    @RestController
    static class FailureController {
        
        @GetMapping("/api/failure")
        String failure() {
            throw new IllegalStateException("private.internal.Type stack detail");
        }
        
        @GetMapping("/api/data")
        String data() {
            throw new DataAccessResourceFailureException("private.sql.Driver connection detail");
        }
        
        @GetMapping("/api/io")
        String io() throws IOException {
            throw new IOException("private/path/configuration detail");
        }
        
        @GetMapping("/api/remote")
        String remote() throws NacosApiException {
            throw new NacosApiException(409, 47777, "remote conflict",
                "resource cannot be published");
        }
        
        @GetMapping("/api/access")
        String access() throws AccessException {
            throw new AccessException("token expired!");
        }
        
        @GetMapping("/api/validation")
        String validation() {
            throw new IllegalArgumentException("invalid resource name");
        }
    }
}
