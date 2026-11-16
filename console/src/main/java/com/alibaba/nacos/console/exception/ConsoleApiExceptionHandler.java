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
import com.alibaba.nacos.api.model.v2.ErrorCode;
import com.alibaba.nacos.api.model.v2.Result;
import com.alibaba.nacos.core.exception.NacosApiExceptionHandler;
import com.alibaba.nacos.sys.env.EnvUtil;
import jakarta.servlet.ServletException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.ResponseStatus;

import java.io.IOException;

/**
 * Optional detail suppression for untyped Console API errors, preserving typed API contracts.
 *
 * @author nacos
 */
@Order(-1)
@ControllerAdvice(name = "nacosApiExceptionHandler", annotations = NacosApi.class)
@ResponseBody
public class ConsoleApiExceptionHandler extends NacosApiExceptionHandler {
    
    private static final Logger LOGGER = LoggerFactory.getLogger(ConsoleApiExceptionHandler.class);
    
    @Override
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    @ExceptionHandler({DataAccessException.class, ServletException.class, IOException.class})
    public Result<String> handleDataAccessException(Exception e) {
        if (!Boolean.FALSE.equals(EnvUtil.getProperty("nacos.console.error.details.enabled",
            Boolean.class, true))) {
            return super.handleDataAccessException(e);
        }
        LOGGER.error("Console API data access failed", e);
        return Result.failure(ErrorCode.DATA_ACCESS_ERROR);
    }
    
    @Override
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    @ExceptionHandler(Exception.class)
    public Result<String> handleOtherException(Exception e) {
        if (!Boolean.FALSE.equals(EnvUtil.getProperty("nacos.console.error.details.enabled",
            Boolean.class, true))) {
            return super.handleOtherException(e);
        }
        LOGGER.error("Console API operation failed", e);
        return Result.failure(ErrorCode.SERVER_ERROR);
    }
}
