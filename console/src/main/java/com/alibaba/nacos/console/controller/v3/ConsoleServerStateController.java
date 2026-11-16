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
 *
 */

package com.alibaba.nacos.console.controller.v3;

import com.alibaba.nacos.api.annotation.Since;
import com.alibaba.nacos.api.annotation.NacosApi;
import com.alibaba.nacos.api.exception.NacosException;
import com.alibaba.nacos.api.model.v2.Result;
import com.alibaba.nacos.api.model.v2.SupportedLanguage;
import com.alibaba.nacos.console.paramcheck.ConsoleDefaultHttpParamExtractor;
import com.alibaba.nacos.console.proxy.ServerStateProxy;
import com.alibaba.nacos.core.paramcheck.ExtractorManager;
import com.alibaba.nacos.sys.env.EnvUtil;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Collections;
import java.util.LinkedHashMap;

/**
 * Controller for managing server state-related operations.
 *
 * @author zhangyukun on:2024/8/27
 */
@NacosApi
@RestController
@RequestMapping("/v3/console/server")
@ExtractorManager.Extractor(httpExtractor = ConsoleDefaultHttpParamExtractor.class)
public class ConsoleServerStateController {
    
    private static final String[] BOOTSTRAP_FIELDS = {"auth_enabled", "auth_admin_request",
        "login_page_enabled", "console_ui_enabled", "console_ui_default", "function_mode",
        "ai_enabled", "copilot_enabled", "auth_system_type"};
    
    private final ServerStateProxy serverStateProxy;
    
    public ConsoleServerStateController(ServerStateProxy serverStateProxy) {
        this.serverStateProxy = serverStateProxy;
    }
    
    /**
     * Get server state of current server.
     *
     * @return state json.
     */
    @Since("3.0.0")
    @GetMapping("/state")
    public ResponseEntity<Map<String, String>> serverState() throws NacosException {
        Map<String, String> serverState = serverStateProxy.getServerState();
        if (Boolean.TRUE.equals(EnvUtil.getProperty("nacos.console.server-state.minimal",
            Boolean.class, false))) {
            Map<String, String> bootstrap = new LinkedHashMap<>();
            for (String field : BOOTSTRAP_FIELDS) {
                if (serverState.containsKey(field)) {
                    bootstrap.put(field, serverState.get(field));
                }
            }
            if ("nacos".equalsIgnoreCase(bootstrap.get("auth_system_type"))) {
                bootstrap.put("auth_system_type", "local");
            }
            serverState = Collections.unmodifiableMap(bootstrap);
        }
        return ResponseEntity.ok().body(serverState);
    }
    
    /**
     * Get the announcement content based on the specified language.
     *
     * @param language Language for the announcement (default: "zh-CN")
     * @return Announcement content as a string wrapped in a Result object
     */
    @Since("3.0.0")
    @GetMapping("/announcement")
    public Result<String> getAnnouncement(
        @RequestParam(required = false, name = "language",
            defaultValue = "zh-CN") String language) {
        // Validate the language parameter
        if (!SupportedLanguage.isSupported(language)) {
            return Result.failure("Unsupported language: " + language);
        }
        String announcement = serverStateProxy.getAnnouncement(language);
        return Result.success(announcement);
    }
    
    /**
     * Get the console UI guide information.
     *
     * @return Console UI guide information as a string wrapped in a Result object
     */
    @Since("3.0.0")
    @GetMapping("/guide")
    public Result<String> getConsoleUiGuide() {
        String guideInformation = serverStateProxy.getConsoleUiGuide();
        return Result.success(guideInformation);
    }
}
