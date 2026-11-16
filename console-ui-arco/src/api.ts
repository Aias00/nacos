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
import { readSession, runtime, writeSession } from './session';
import type { ClusterNode, Config, ConfigTarget, History, Namespace, Page, Params,
  Service, ServiceDetail, Session, Instance, Subscriber } from './types';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function isExpired(status: number, message: string) {
  return status === 401 || /unknown user|user not found|token.*(invalid|expired|empty|required)|invalid.*token|expired.*token|invalid signature/i.test(message);
}

export async function request<T>(path: string, params: Params = {}, method = 'GET', signal?: AbortSignal): Promise<T> {
  const session = readSession();
  if (session?.mode === 'demo') {
    const { demoRequest } = await import('./demo');
    return demoRequest<T>(path, params, method);
  }
  const url = new URL(runtime().apiBase + path, window.location.origin);
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) values.set(key, String(value));
  }
  if (session && !path.startsWith('v3/auth/')) url.searchParams.set('username', session.username);
  const headers = new Headers();
  if (session) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
    headers.set('accessToken', session.accessToken);
  }
  const isForm = method === 'POST' || method === 'PUT';
  if (!isForm) for (const [key, value] of values) url.searchParams.set(key, value);
  if (isForm) headers.set('Content-Type', 'application/x-www-form-urlencoded');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 15000);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { method, headers, body: isForm ? values : undefined, signal: controller.signal });
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new ApiError('请求超时，请检查服务连接后重试', 0);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
  let body: { code?: number; message?: string; data?: unknown };
  try { body = JSON.parse(text); }
  catch {
    if (session && response.status === 401) writeSession(null);
    throw new ApiError(response.ok ? '接口返回格式异常' : `请求失败（HTTP ${response.status}）`, response.status);
  }
  if (!response.ok || (body.code !== undefined && body.code !== 0)) {
    const message = typeof body.data === 'string' && body.data ? body.data : body.message || `请求失败（HTTP ${response.status}）`;
    if (session && isExpired(response.status, message)) writeSession(null);
    throw new ApiError(message, response.status);
  }
  return (body.code === undefined ? body : body.data) as T;
}

const CS = 'v3/console/cs/';
const NS = 'v3/console/ns/';
const CORE = 'v3/console/core/';
export const api = {
  login: (username: string, password: string) =>
    request<Pick<Session, 'accessToken' | 'globalAdmin' | 'username'>>('v3/auth/user/login', { username, password }, 'POST'),
  state: () => request<Record<string, string | boolean>>('v3/console/server/state'),
  namespaces: (signal?: AbortSignal) => request<Namespace[]>(CORE + 'namespace/list', {}, 'GET', signal),
  createNamespace: (values: Params) => request<boolean>(CORE + 'namespace', values, 'POST'),
  updateNamespace: (values: Params) => request<boolean>(CORE + 'namespace', values, 'PUT'),
  deleteNamespace: (namespaceId: string) => request<boolean>(CORE + 'namespace', { namespaceId }, 'DELETE'),
  configs: (params: Params, signal?: AbortSignal) => request<Page<Config>>(CS + 'config/list', params, 'GET', signal),
  config: (target: ConfigTarget) => request<Config>(CS + 'config', { ...target }),
  publish: (target: ConfigTarget, config: Config) => request<boolean>(CS + 'config', {
    ...target, content: config.content, type: config.type, desc: config.desc || '',
    appName: config.appName || '', configTags: config.configTags || '',
  }, 'POST'),
  deleteConfig: (target: ConfigTarget) => request<boolean>(CS + 'config', { ...target }, 'DELETE'),
  history: (target: ConfigTarget, pageNo: number, pageSize = 10) =>
    request<Page<History>>(CS + 'history/list', { ...target, pageNo, pageSize }),
  historyDetail: (target: ConfigTarget, nid: string) => request<History>(CS + 'history', { ...target, nid }),
  listeners: (params: Params, byIp = false) => request<{ listenersStatus: Record<string, string> }>(CS + `config/listener${byIp ? '/ip' : ''}`, params),
  services: (params: Params, signal?: AbortSignal) => request<Page<Service>>(NS + 'service/list', params, 'GET', signal),
  service: (params: Params) => request<ServiceDetail>(NS + 'service', params),
  instances: (params: Params) => request<Page<Instance>>(NS + 'instance/list', params),
  updateInstance: (params: Params) => request<string>(NS + 'instance', params, 'PUT'),
  subscribers: (params: Params) => request<Page<Subscriber>>(NS + 'service/subscribers', params),
  cluster: (keyword = '', signal?: AbortSignal) => request<ClusterNode[]>(CORE + 'cluster/nodes', { keyword }, 'GET', signal),
  users: (pageNo: number) => request<Page<{ username: string }>>('v3/auth/user/list', { pageNo, pageSize: 10 }),
  roles: (pageNo: number) => request<Page<{ username: string; role: string }>>('v3/auth/role/list', { pageNo, pageSize: 10 }),
  permissions: (pageNo: number) => request<Page<{ role: string; resource: string; action: string }>>('v3/auth/permission/list', { pageNo, pageSize: 10 }),
};

export async function updateInstanceAndWait(params: Params, pageNo: number) {
  await api.updateInstance(params);
  const deadline = Date.now() + 10000;
  while (true) {
    const page = await api.instances({ namespaceId: params.namespaceId, groupName: params.groupName,
      serviceName: params.serviceName, pageNo, pageSize: 10 });
    const instance = page.pageItems.find((item) => item.ip === params.ip && item.port === Number(params.port)
      && item.clusterName === params.clusterName);
    if (instance && String(instance.enabled) === String(params.enabled)) return;
    if (Date.now() >= deadline) throw new ApiError('实例状态尚未同步，请刷新列表确认', 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
