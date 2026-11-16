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
import type { Config, History, Instance, Namespace, Params, Service } from './types';

const now = () => String(Date.now());
let nextId = 100;
const namespaces: Namespace[] = [
  { namespace: 'dev', namespaceShowName: '开发环境', namespaceDesc: '日常开发与联调', configCount: 0, quota: 200, type: 2 },
  { namespace: 'test', namespaceShowName: '测试环境', namespaceDesc: '集成与回归测试', configCount: 0, quota: 200, type: 2 },
  { namespace: 'prod', namespaceShowName: '生产环境', namespaceDesc: '线上正式环境', configCount: 0, quota: 200, type: 2 },
];
type DemoConfig = Config & { namespaceId: string };
const configs: DemoConfig[] = namespaces.flatMap((ns) => [
  { id: String(++nextId), namespaceId: ns.namespace, dataId: 'gateway.yaml', groupName: 'DEFAULT_GROUP',
    content: 'server:\n  port: 9195\nspring:\n  application:\n    name: gateway\n', type: 'yaml', appName: 'gateway', desc: '网关基础配置', configTags: 'gateway', modifyTime: now() },
  { id: String(++nextId), namespaceId: ns.namespace, dataId: 'application.yaml', groupName: 'DEFAULT_GROUP',
    content: `spring:\n  profiles:\n    active: ${ns.namespace}\nmanagement:\n  endpoints:\n    web:\n      exposure:\n        include: health,info\n`, type: 'yaml', appName: 'application', desc: '应用公共配置', modifyTime: now() },
  { id: String(++nextId), namespaceId: ns.namespace, dataId: 'datasource.properties', groupName: 'DATA_GROUP',
    content: 'spring.datasource.url=jdbc:postgresql://127.0.0.1:5432/application\nspring.datasource.username=${DB_USERNAME}\nspring.datasource.password=${DB_PASSWORD}\n', type: 'properties', appName: 'data-service', desc: '数据源配置', modifyTime: now() },
  { id: String(++nextId), namespaceId: ns.namespace, dataId: 'feature-flags.json', groupName: 'DEFAULT_GROUP',
    content: '{\n  "auditEnabled": true,\n  "maxPageSize": 100\n}\n', type: 'json', appName: 'application', desc: '业务功能开关', modifyTime: now() },
]);
const services: Array<Service & { namespaceId: string }> = namespaces.flatMap((ns) => [
  { namespaceId: ns.namespace, name: 'gateway', groupName: 'DEFAULT_GROUP', clusterCount: 1, ipCount: 2, healthyInstanceCount: 2 },
  { namespaceId: ns.namespace, name: 'user-service', groupName: 'DEFAULT_GROUP', clusterCount: 1, ipCount: 2, healthyInstanceCount: 2 },
  { namespaceId: ns.namespace, name: 'data-service', groupName: 'DATA_GROUP', clusterCount: 1, ipCount: 1, healthyInstanceCount: 1 },
]);
const instances = new Map<string, Instance[]>();
for (const service of services) {
  instances.set(`${service.namespaceId}/${service.groupName}/${service.name}`, Array.from({ length: service.ipCount }, (_, i) => ({
    ip: `10.0.0.${11 + i}`, port: 8080, clusterName: 'DEFAULT', weight: 1,
    healthy: true, enabled: true, ephemeral: true, metadata: { version: '1.0.0', zone: 'zone-a' },
  })));
}
type DemoHistory = History & { namespaceId: string };
const histories: DemoHistory[] = configs.map((config) => ({
  id: String(++nextId), namespaceId: config.namespaceId, dataId: config.dataId,
  groupName: config.groupName, content: config.content, type: config.type,
  srcUser: 'demo', opType: 'I', createdTime: now(),
}));

function page<T>(items: T[], params: Params) {
  const size = Number(params.pageSize || 10);
  const number = Number(params.pageNo || 1);
  return { totalCount: items.length, pageNumber: number, pageItems: items.slice((number - 1) * size, number * size) };
}

export async function demoRequest<T>(path: string, p: Params = {}, method = 'GET'): Promise<T> {
  const namespace = String(p.namespaceId || 'public');
  const matches = (config: { namespaceId: string; dataId: string; groupName: string }) =>
    config.namespaceId === namespace && config.dataId === p.dataId && config.groupName === p.groupName;
  let result: unknown;
  if (path === 'v3/console/server/state') {
    result = { version: '3.3.0', auth_enabled: true, console_ui_enabled: true, ai_enabled: true, copilot_enabled: true };
  } else if (path.endsWith('/core/namespace/list')) {
    result = namespaces.map((ns) => ({ ...ns, configCount: configs.filter((c) => c.namespaceId === ns.namespace).length }));
  } else if (path.endsWith('/core/namespace')) {
    if (method === 'POST') {
      const id = String(p.customNamespaceId || `namespace-${++nextId}`).trim();
      if (namespaces.some((ns) => ns.namespace === id)) throw new Error('命名空间 ID 已存在');
      namespaces.push({ namespace: id, namespaceShowName: String(p.namespaceName), namespaceDesc: String(p.namespaceDesc || ''), configCount: 0, quota: 200, type: 2 });
    } else if (method === 'PUT') {
      const ns = namespaces.find((ns) => ns.namespace === namespace);
      if (!ns) throw new Error('命名空间不存在');
      ns.namespaceShowName = String(p.namespaceName);
      ns.namespaceDesc = String(p.namespaceDesc || '');
    } else if (method === 'DELETE') {
      if (configs.some((c) => c.namespaceId === namespace) || services.some((s) => s.namespaceId === namespace)) throw new Error('请先清空命名空间中的配置和服务');
      const index = namespaces.findIndex((ns) => ns.namespace === namespace);
      if (index >= 0) namespaces.splice(index, 1);
    }
    result = true;
  } else if (path.endsWith('/cs/config/list')) {
    result = page(configs.filter((c) => c.namespaceId === namespace
      && c.dataId.includes(String(p.dataId || '')) && c.groupName.includes(String(p.groupName || ''))), p);
  } else if (path.endsWith('/cs/config')) {
    const index = configs.findIndex(matches);
    if (method === 'GET') {
      if (index < 0) throw new Error('配置不存在');
      result = configs[index];
    } else {
      if (method === 'DELETE') {
        if (index < 0) throw new Error('配置不存在');
        configs.splice(index, 1);
      } else {
        if (!String(p.content || '').trim()) throw new Error('配置内容不能为空');
        const value: DemoConfig = { id: index < 0 ? String(++nextId) : configs[index].id,
          namespaceId: namespace, dataId: String(p.dataId), groupName: String(p.groupName),
          content: String(p.content), type: String(p.type), appName: String(p.appName || ''),
          desc: String(p.desc || ''), configTags: String(p.configTags || ''), modifyTime: now() };
        if (index < 0) configs.push(value); else configs[index] = value;
        histories.unshift({ ...value, id: String(++nextId), srcUser: 'demo', opType: index < 0 ? 'I' : 'U', createdTime: now() });
      }
      result = true;
    }
  } else if (path.endsWith('/cs/history/list')) {
    result = page(histories.filter(matches), p);
  } else if (path.endsWith('/cs/history')) {
    result = histories.find((history) => matches(history) && history.id === String(p.nid));
    if (!result) throw new Error('历史版本不存在');
  } else if (path.includes('/cs/config/listener')) {
    result = { listenersStatus: path.endsWith('/ip') ? { 'application.yaml+DEFAULT_GROUP': '8fc21a76a2f01e45' } : { '10.0.0.11': '8fc21a76a2f01e45', '10.0.0.12': '8fc21a76a2f01e45' } };
  } else if (path.endsWith('/ns/service/list')) {
    result = page(services.filter((s) => s.namespaceId === namespace
      && s.name.includes(String(p.serviceNameParam || '')) && s.groupName.includes(String(p.groupNameParam || ''))), p);
  } else if (path.endsWith('/ns/service')) {
    const service = services.find((s) => s.namespaceId === namespace && s.name === p.serviceName && s.groupName === p.groupName);
    if (!service) throw new Error('服务不存在');
    result = { serviceName: service.name, groupName: service.groupName, ephemeral: true,
      protectThreshold: 0, metadata: { version: '1.0.0' },
      clusterMap: { DEFAULT: { hosts: instances.get(`${namespace}/${p.groupName}/${p.serviceName}`) || [] } } };
  } else if (path.endsWith('/ns/instance/list')) {
    result = page(instances.get(`${namespace}/${p.groupName}/${p.serviceName}`) || [], p);
  } else if (path.endsWith('/ns/instance') && method === 'PUT') {
    const instance = (instances.get(`${namespace}/${p.groupName}/${p.serviceName}`) || []).find((item) =>
      item.ip === p.ip && item.port === Number(p.port) && item.clusterName === p.clusterName);
    if (!instance) throw new Error('实例不存在');
    instance.weight = Number(p.weight);
    instance.enabled = String(p.enabled) === 'true';
    result = 'ok';
  } else if (path.endsWith('/ns/service/subscribers')) {
    result = page([{ ip: '10.0.0.21', port: 50836, appName: 'gateway', agent: 'Java Client' }], p);
  } else if (path.endsWith('/core/cluster/nodes')) {
    result = [{ address: '127.0.0.1:8848', ip: '127.0.0.1', port: 8848, state: 'UP' }].filter((node) => node.ip.includes(String(p.keyword || '')));
  } else if (path.endsWith('/auth/user/list')) {
    result = page([{ username: 'demo' }, { username: 'readonly' }], p);
  } else if (path.endsWith('/auth/role/list')) {
    result = page([{ username: 'demo', role: 'ROLE_ADMIN' }, { username: 'readonly', role: 'ROLE_READER' }], p);
  } else if (path.endsWith('/auth/permission/list')) {
    result = page([{ role: 'ROLE_READER', resource: 'dev:*:config/*', action: 'r' }], p);
  } else throw new Error(`演示模式不支持此操作：${path}`);
  return structuredClone(result) as T;
}
