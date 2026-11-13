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

import com.alibaba.nacos.api.annotation.Since;
import com.alibaba.nacos.console.config.ConsoleBranding;
import com.alibaba.nacos.sys.env.EnvUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.net.URI;

/**
 * Controller to redirect root path to the default console UI.
 *
 * <p>The default UI version is controlled by the property {@code nacos.console.ui.default}.
 * Supported values: "next" (new UI) and "legacy" (old UI). Defaults to "next".
 *
 * @author zhuoguang
 */
@Controller
public class ConsoleRedirectController {
    
    private static final String PROPERTY_DEFAULT_UI = "nacos.console.ui.default";
    
    private static final String UI_LEGACY = "legacy";
    
    private static final String UI_NEXT = "next";
    
    @Since("3.2.0")
    @GetMapping("/")
    public String index() {
        return "redirect:/" + defaultUi() + "/";
    }
    
    @Since("3.2.0")
    @GetMapping("/next/")
    public String next() {
        return "forward:/next/index.html";
    }
    
    @Since("3.2.0")
    @GetMapping("/legacy/")
    public String legacy() {
        return "forward:/legacy/index.html";
    }
    
    /**
     * Serve the Next UI entry with optional deployment branding.
     *
     * @return console HTML
     * @throws IOException if the packaged HTML cannot be read
     */
    @GetMapping(value = "/next/index.html", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> nextIndex() throws IOException {
        return uiIndex(UI_NEXT);
    }
    
    /**
     * Serve the Legacy UI entry with optional deployment branding.
     *
     * @return console HTML
     * @throws IOException if the packaged HTML cannot be read
     */
    @GetMapping(value = "/legacy/index.html", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> legacyIndex() throws IOException {
        return uiIndex(UI_LEGACY);
    }
    
    /**
     * Preserve the historical static entry, or redirect it to a branding-aware UI.
     *
     * @param request console request
     * @return original HTML or a redirect when custom branding is enabled
     * @throws IOException if the packaged HTML cannot be read
     */
    @GetMapping({"/console-ui/", "/console-ui/index.html"})
    public ResponseEntity<String> consoleUiIndex(HttpServletRequest request) throws IOException {
        if (ConsoleBranding.isConfigured()) {
            URI location = URI.create(request.getContextPath() + "/" + defaultUi() + "/");
            return ResponseEntity.status(HttpStatus.FOUND).location(location)
                .cacheControl(CacheControl.noStore()).build();
        }
        return uiIndex("console-ui");
    }
    
    private String defaultUi() {
        return UI_LEGACY.equals(EnvUtil.getProperty(PROPERTY_DEFAULT_UI, UI_NEXT)) ? UI_LEGACY
            : UI_NEXT;
    }
    
    private ResponseEntity<String> uiIndex(String ui) throws IOException {
        ClassPathResource resource = new ClassPathResource("static/" + ui + "/index.html");
        if (!resource.exists()) {
            return ResponseEntity.notFound().build();
        }
        String html = resource.getContentAsString(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
            .contentType(new MediaType("text", "html", StandardCharsets.UTF_8))
            .cacheControl(CacheControl.noStore()).body(ConsoleBranding.apply(html));
    }
}
