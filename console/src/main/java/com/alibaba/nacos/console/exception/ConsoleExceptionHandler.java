/*
 * Copyright 1999-2018 Alibaba Group Holding Ltd.
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
import com.alibaba.nacos.api.model.v2.Result;
import com.alibaba.nacos.plugin.auth.exception.AccessException;
import com.alibaba.nacos.common.model.RestResultUtils;
import com.alibaba.nacos.common.utils.ExceptionUtil;
import com.alibaba.nacos.core.utils.Commons;
import com.alibaba.nacos.sys.env.EnvUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.util.HtmlUtils;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Exception handler for console module.
 *
 * @author nkorange
 * @since 1.2.0
 */
@ControllerAdvice
public class ConsoleExceptionHandler {
    
    private static final Logger LOGGER = LoggerFactory.getLogger(ConsoleExceptionHandler.class);
    
    @ExceptionHandler(AccessException.class)
    private ResponseEntity<String> handleAccessException(AccessException e) {
        LOGGER.error("got exception. {}", e.getErrMsg());
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(e.getErrMsg());
    }
    
    @ExceptionHandler(IllegalArgumentException.class)
    private ResponseEntity<String> handleIllegalArgumentException(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ExceptionUtil.getAllExceptionMsg(e));
    }
    
    @ExceptionHandler(NacosRuntimeException.class)
    private ResponseEntity<String> handleNacosRuntimeException(NacosRuntimeException e) {
        LOGGER.error("got exception. {}", e.getMessage());
        return ResponseEntity.status(e.getErrCode()).body(ExceptionUtil.getAllExceptionMsg(e));
    }
    
    @ExceptionHandler(Exception.class)
    private ResponseEntity<Object> handleException(HttpServletRequest request, Exception e) {
        String uri = request.getRequestURI();
        LOGGER.error("CONSOLE {}", uri, e);
        if (Boolean.FALSE.equals(EnvUtil.getProperty("nacos.console.error.details.enabled",
            Boolean.class, true))) {
            HttpStatus status = HttpStatus.INTERNAL_SERVER_ERROR;
            if (e instanceof HttpRequestMethodNotSupportedException) {
                status = HttpStatus.METHOD_NOT_ALLOWED;
            } else if (e instanceof NoResourceFoundException
                || e instanceof NoHandlerFoundException) {
                status = HttpStatus.NOT_FOUND;
            }
            return ResponseEntity.status(status)
                .body(new Result<>(status.value(), status.getReasonPhrase(), null));
        }
        if (uri.contains(Commons.NACOS_SERVER_VERSION_V2)) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(RestResultUtils
                    .failed(HtmlUtils.htmlEscape(ExceptionUtil.getAllExceptionMsg(e), "utf-8")));
        }
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(HtmlUtils.htmlEscape(ExceptionUtil.getAllExceptionMsg(e), "utf-8"));
    }
}
