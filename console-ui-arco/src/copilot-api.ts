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
import { request, requestJson } from './api';

export interface CopilotConfig {
  apiKey: string;
  model: string;
  studioUrl?: string | null;
  studioProject?: string | null;
}
export type CopilotChanges = Partial<CopilotConfig>;
const PATH = 'v3/console/copilot/config';

export function readCopilotConfig(value: unknown): CopilotConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Copilot 配置响应格式异常');
  const config = value as Record<string, unknown>;
  for (const key of ['apiKey', 'model', 'studioUrl', 'studioProject']) {
    if (config[key] != null && typeof config[key] !== 'string') throw new Error('Copilot 配置响应字段格式异常');
  }
  return { apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    model: typeof config.model === 'string' ? config.model : 'qwen-turbo',
    ...(config.studioUrl !== undefined ? { studioUrl: config.studioUrl as string | null } : {}),
    ...(config.studioProject !== undefined ? { studioProject: config.studioProject as string | null } : {}) };
}
export function prepareCopilotUpdate(original: CopilotConfig, changes: CopilotChanges): CopilotConfig {
  const config = readCopilotConfig({ ...original, ...changes });
  config.apiKey = config.apiKey.trim();
  config.model = config.model.trim();
  if (!config.model) throw new Error('请输入 DashScope 支持的 Qwen 模型名称');
  if (config.studioUrl?.trim()) {
    try {
      const url = new URL(config.studioUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    } catch { throw new Error('Studio URL 必须是有效的 HTTP 或 HTTPS 地址'); }
  }
  return config;
}
export function clearsCopilotKey(original: CopilotConfig, next: CopilotConfig) {
  return !!original.apiKey.trim() && !next.apiKey.trim();
}
export const copilotApi = {
  get: async (signal?: AbortSignal) => readCopilotConfig(await request<unknown>(PATH, {}, 'GET', signal)),
  save: async (config: CopilotConfig) => {
    if (await requestJson<boolean>(PATH, config) !== true) throw new Error('Copilot 配置未保存成功');
  },
};
