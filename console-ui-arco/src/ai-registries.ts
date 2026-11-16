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
import { request } from './api';
import type { Page, Params } from './types';

export type RegistryKind = 'mcp' | 'agent';
export interface RegistryTarget { kind: RegistryKind; namespaceId: string; name: string }
export interface RegistryVersion {
  version: string; status: string; publishPipelineInfo?: unknown; author?: string;
  description?: string; changeDescription?: string; latest?: boolean; labels?: string[] | Record<string, string>;
  createTime?: number; updateTime?: number; writable?: boolean;
  serverSpecification?: Record<string, unknown>; toolSpecification?: Record<string, unknown>;
  resourceSpecification?: Record<string, unknown>; callInterfaces?: CallInterface[];
  resourceStatus?: string; scope?: string; owner?: string; editingVersion?: string;
  reviewingVersion?: string; onlineCount?: number;
}
export interface RegistryResource {
  name?: string; agentName?: string; displayName?: string; description?: string;
  protocol?: string; frontProtocol?: string; enabled?: boolean; status?: string;
  owner?: string; scope?: string; writable?: boolean; iconUrl?: string;
  provider?: Record<string, unknown>; tags?: string[]; extensions?: Record<string, unknown>;
  versionDetail?: { version: string }; labels?: Record<string, string>;
  versionInfo?: { editingVersion?: string; reviewingVersion?: string; labels?: Record<string, string>; onlineVersions?: RegistryVersion[] };
  frontendEndpoints?: McpEndpoint[]; backendEndpoints?: McpEndpoint[];
  localServerConfig?: Record<string, unknown>; packages?: unknown[];
  remoteServerConfig?: Record<string, unknown>; toolSpec?: Record<string, unknown>;
}
export interface McpEndpoint { protocol?: string; address?: string; port?: string | number; path?: string }
export interface AgentEndpoint {
  uri: string; transport: string; priority?: number; weight?: number;
  healthy?: boolean; enabled?: boolean; metadata?: Record<string, unknown>; bindings?: unknown[];
}
export interface CallInterface {
  protocol: string; protocolVersion?: string; nativeDescriptor?: unknown;
  descriptorMediaType?: string; endpointSourceOrder?: string[];
  endpointSets?: { source: string; endpoints: AgentEndpoint[] }[];
}
export interface RegistryOverview { agent: RegistryResource; versionPage: Page<RegistryVersion> }
export interface RuntimeView {
  runtimeEndpointSnapshot: { callInterface: CallInterface };
  namingServiceRef?: { namespaceId: string; groupName: string; serviceName: string };
}

function base(kind: RegistryKind) { return `v3/console/ai/${kind === 'mcp' ? 'mcp' : 'agents'}`; }
function identity(target: RegistryTarget): Params {
  return { namespaceId: target.namespaceId, [target.kind === 'mcp' ? 'mcpName' : 'agentName']: target.name };
}
export function registryName(resource: RegistryResource) { return resource.agentName || resource.name || ''; }

/** Lifecycle detail remains available before any version can be served to clients. */
export function mcpManagementResource(name: string, version: RegistryVersion): RegistryResource {
  return { ...version.serverSpecification, name, writable: version.writable,
    status: version.resourceStatus, scope: version.scope, owner: version.owner,
    labels: version.labels && !Array.isArray(version.labels) ? version.labels : {},
    versionInfo: { editingVersion: version.editingVersion, reviewingVersion: version.reviewingVersion } };
}
export type RegistryVersionAction = 'submit' | 'publish' | 'force-publish' | 'redraft' | 'online' | 'offline';

/** A terminal review result may need Submit to reconcile an interrupted status callback. */
export function registryVersionActions(status: string, currentPipeline: string | null, globalAdmin: boolean): RegistryVersionAction[] {
  if (status === 'draft') return ['submit'];
  if (status === 'online') return ['offline'];
  if (status === 'offline') return ['online'];
  const actions: RegistryVersionAction[] = [];
  if (status === 'reviewed') {
    actions.push('submit', 'redraft');
    if (currentPipeline === 'APPROVED') actions.push('publish');
  } else if (status === 'reviewing' && ['APPROVED', 'REJECTED'].includes(currentPipeline || '')) actions.push('submit');
  if (globalAdmin && ['reviewing', 'reviewed'].includes(status) && currentPipeline === 'REJECTED') actions.push('force-publish');
  return actions;
}

export const registries = {
  list: (kind: RegistryKind, params: Params, signal?: AbortSignal) =>
    request<Page<RegistryResource>>(`${base(kind)}/list`, params, 'GET', signal),
  overview: (target: RegistryTarget, signal?: AbortSignal) =>
    request<RegistryResource | RegistryOverview>(base(target.kind), identity(target), 'GET', signal),
  serving: (target: RegistryTarget, version: string, signal?: AbortSignal) =>
    request<RegistryResource>(base(target.kind), { ...identity(target), version }, 'GET', signal),
  versions: (target: RegistryTarget, pageNo = 1, signal?: AbortSignal) =>
    request<Page<RegistryVersion>>(`${base(target.kind)}/versions`, { ...identity(target), pageNo, pageSize: 10 }, 'GET', signal),
  version: (target: RegistryTarget, version: string, signal?: AbortSignal) =>
    request<RegistryVersion>(`${base(target.kind)}/version`, { ...identity(target), version }, 'GET', signal),
  runtime: (target: RegistryTarget, version: string, protocol: string, signal?: AbortSignal) =>
    request<RuntimeView>(`${base(target.kind)}/runtime-endpoints`, { ...identity(target), version, protocol }, 'GET', signal),
  draft: (target: RegistryTarget, version: string, values: Params, update = false) =>
    request<RegistryVersion>(`${base(target.kind)}/draft`, { ...values, ...identity(target), version }, update ? 'PUT' : 'POST'),
  action: (target: RegistryTarget, version: string, action: RegistryVersionAction) =>
    request<RegistryVersion>(`${base(target.kind)}/${action}`, { ...identity(target), version }, 'POST'),
  deleteDraft: (target: RegistryTarget, version: string) =>
    request<void>(`${base(target.kind)}/draft`, { ...identity(target), version }, 'DELETE'),
  remove: (target: RegistryTarget) => request<void>(base(target.kind), identity(target), 'DELETE'),
  scope: (target: RegistryTarget, scope: string) =>
    request<string>(`${base(target.kind)}/scope`, { ...identity(target), scope }, 'PUT'),
  labels: (target: RegistryTarget, labels: Record<string, string>) => {
    const custom = { ...labels }; delete custom.latest;
    return request<unknown>(`${base(target.kind)}/labels`, { ...identity(target), labels: JSON.stringify(custom) }, 'PUT');
  },
  status: (target: RegistryTarget, enabled: boolean, resource: RegistryResource) => target.kind === 'mcp'
    ? request<string>(`${base(target.kind)}/status`, { ...identity(target), enabled }, 'PUT')
    : registries.metadata(target, { ...resource, status: enabled ? 'enable' : 'disable' }),
  metadata: (target: RegistryTarget, resource: RegistryResource) => request<RegistryResource>(base(target.kind), {
    ...identity(target), displayName: resource.displayName || '', description: resource.description || '',
    iconUrl: resource.iconUrl || '', status: resource.status || 'enable',
    provider: resource.provider ? JSON.stringify(resource.provider) : undefined,
    tags: JSON.stringify(resource.tags || []), extensions: JSON.stringify(resource.extensions || {}),
  }, 'PUT'),
};

export function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`${label} 不是有效的 JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象`);
  return value as Record<string, unknown>;
}

export interface DraftFields {
  name: string; version: string; description: string; protocol: string; endpoint: string;
  server: string; tools: string; resources: string; endpointSpecification: string;
  callInterfaces: string; displayName: string; changeDescription: string;
}
function preservedEndpoint(specification: Record<string, unknown>): string {
  const remote = specification.remoteServerConfig;
  if (!remote || typeof remote !== 'object' || !('serviceRef' in remote)) return '';
  const reference = remote.serviceRef;
  if (!reference || typeof reference !== 'object' || !('namespaceId' in reference)
    || typeof reference.namespaceId !== 'string' || !('groupName' in reference)
    || typeof reference.groupName !== 'string' || !reference.groupName
    || !('serviceName' in reference) || typeof reference.serviceName !== 'string' || !reference.serviceName) return '';
  return JSON.stringify({ type: 'REF', data: { namespaceId: reference.namespaceId,
    groupName: reference.groupName, serviceName: reference.serviceName,
    ...('transportProtocol' in reference && typeof reference.transportProtocol === 'string'
      ? { transportProtocol: reference.transportProtocol } : {}) } }, null, 2);
}
export function initialDraft(name = '', source?: RegistryVersion): DraftFields {
  const specification = source?.serverSpecification || {};
  return {
    name, version: source?.version || '1.0.0', description: String(specification.description || ''),
    protocol: String(specification.frontProtocol || 'mcp-streamable'), endpoint: '',
    server: JSON.stringify(specification, null, 2), tools: JSON.stringify(source?.toolSpecification || { tools: [] }, null, 2),
    resources: JSON.stringify(source?.resourceSpecification || {}, null, 2), endpointSpecification: preservedEndpoint(specification),
    displayName: '', changeDescription: source?.changeDescription || '',
    callInterfaces: JSON.stringify(source?.callInterfaces || [{ protocol: 'A2A', protocolVersion: '0.3.0',
      descriptorMediaType: 'application/json', nativeDescriptor: {}, endpointSourceOrder: ['RUNTIME', 'DECLARED'],
      endpointSets: [{ source: 'DECLARED', endpoints: [] }] }], null, 2),
  };
}

export function draftPayload(kind: RegistryKind, fields: DraftFields, update: boolean, existing: boolean): Params {
  if (!fields.name.trim() || !fields.version.trim()) throw new Error('名称与精确版本不能为空');
  if (kind === 'agent') {
    let interfaces: unknown;
    try { interfaces = JSON.parse(fields.callInterfaces); } catch { throw new Error('调用接口不是有效的 JSON'); }
    if (!Array.isArray(interfaces) || !interfaces.length || interfaces.some((item) => !item || typeof item !== 'object' || !item.protocol)) {
      throw new Error('调用接口必须是非空数组，每项须包含 protocol');
    }
    return { callInterfaces: JSON.stringify(interfaces), changeDescription: fields.changeDescription,
      ...(!update && !existing ? { displayName: fields.displayName, description: fields.description } : {}) };
  }
  const server = parseObject(fields.server, '服务高级设置');
  const previousProtocol = server.frontProtocol;
  Object.assign(server, { name: fields.name.trim(), version: fields.version.trim(), description: fields.description, frontProtocol: fields.protocol,
    protocol: !server.protocol || server.protocol === previousProtocol ? fields.protocol : server.protocol,
    versionDetail: { ...(server.versionDetail as object || {}), version: fields.version.trim() } });
  if (server.enabled === undefined) server.enabled = true;
  let endpointSpecification = fields.endpointSpecification.trim();
  if (fields.protocol === 'stdio') {
    server.protocol = 'stdio';
    if (!server.localServerConfig && !server.packages) throw new Error('stdio 需在服务高级设置中填写 localServerConfig 或 packages');
  } else if (fields.endpoint.trim()) {
    let url: URL;
    try { url = new URL(fields.endpoint); } catch { throw new Error('请输入完整的 HTTP 或 HTTPS Endpoint URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Endpoint 应为不含内嵌凭据或 fragment 的 HTTP/HTTPS 地址');
    server.remoteServerConfig = { ...(server.remoteServerConfig as object || {}), exportPath: `${url.pathname}${url.search}` };
    endpointSpecification = JSON.stringify({ type: 'DIRECT', data: { address: url.hostname, port: url.port || (url.protocol === 'https:' ? '443' : '80'), transportProtocol: url.protocol.slice(0, -1) } });
  } else {
    endpointSpecification ||= preservedEndpoint(server);
    if (!endpointSpecification) throw new Error(existing
      ? '无法保留原 MCP Endpoint：服务定义缺少完整的 serviceRef，请明确填写 Endpoint URL 或高级 Endpoint 设置'
      : '非 stdio MCP 必须填写 Endpoint URL 或完整的高级 Endpoint 设置');
    if (!server.remoteServerConfig) server.remoteServerConfig = {};
  }
  if (endpointSpecification && fields.protocol !== 'stdio') {
    const endpoint = parseObject(endpointSpecification, 'Endpoint 设置');
    const data = endpoint.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Endpoint 设置必须包含 data 对象');
    const values = data as Record<string, unknown>;
    const type = String(endpoint.type || '').toUpperCase();
    if (type === 'REF') {
      if (typeof values.namespaceId !== 'string' || typeof values.groupName !== 'string' || !values.groupName
        || typeof values.serviceName !== 'string' || !values.serviceName) throw new Error('REF Endpoint 需填写完整的 namespaceId、groupName 和 serviceName');
    } else if (type === 'DIRECT') {
      const port = Number(values.port);
      if (typeof values.address !== 'string' || !values.address.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('DIRECT Endpoint 需填写 address 和 1–65535 的 port');
      }
    } else throw new Error('Endpoint type 必须为 REF 或 DIRECT');
  }
  return { serverSpecification: JSON.stringify(server),
    toolSpecification: JSON.stringify(parseObject(fields.tools, '工具定义')),
    resourceSpecification: JSON.stringify(parseObject(fields.resources, '资源定义')),
    endpointSpecification: endpointSpecification || undefined };
}

export function customLabels(text: string): Record<string, string> {
  const object = parseObject(text, '版本标签');
  if (Object.prototype.hasOwnProperty.call(object, 'latest')) throw new Error('latest 由服务端维护，请勿手动设置');
  if (Object.entries(object).some(([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim())) {
    throw new Error('标签名称和目标版本须为非空字符串');
  }
  return object as Record<string, string>;
}

/** Published HTTP-to-MCP gateways must never expose their backend URL as a client URL. */
export function mcpClientConfigs(name: string, resource: RegistryResource): { label: string; config: unknown }[] {
  if (resource.frontProtocol === 'stdio' || resource.protocol === 'stdio') {
    const local = resource.localServerConfig;
    if (!local) return [];
    return [{ label: name, config: local.mcpServers ? local : { mcpServers: { [name]: local } } }];
  }
  const endpoints = ['http', 'https'].includes(resource.protocol || '')
    ? resource.frontendEndpoints || [] : resource.frontendEndpoints?.length ? resource.frontendEndpoints : resource.backendEndpoints || [];
  return endpoints.filter((endpoint) => endpoint.address).map((endpoint) => {
    const protocol = ['http', 'https'].includes(endpoint.protocol || '') ? endpoint.protocol : 'http';
    const port = endpoint.port && !((protocol === 'http' && String(endpoint.port) === '80') || (protocol === 'https' && String(endpoint.port) === '443')) ? `:${endpoint.port}` : '';
    const path = endpoint.path || String(resource.remoteServerConfig?.exportPath || '');
    const address = endpoint.address?.includes(':') && !endpoint.address.startsWith('[') ? `[${endpoint.address}]` : endpoint.address;
    const url = `${protocol}://${address}${port}${path && !path.startsWith('/') ? '/' : ''}${path}`;
    return { label: url, config: { mcpServers: { [name]: { url } } } };
  });
}
