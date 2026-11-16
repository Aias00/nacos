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
import type { Params } from './types';

type Kind = 'mcp' | 'agents' | 'prompt' | 'skills' | 'agentspecs';
type Status = 'draft' | 'reviewing' | 'reviewed' | 'online' | 'offline';
type Fields = Record<string, unknown>;
interface Version {
  version: string;
  status: Status;
  payload: Fields;
  commitMsg: string;
  updateTime: number;
  publishPipelineInfo: string | null;
}
interface Resource {
  kind: Kind;
  namespaceId: string;
  name: string;
  description: string;
  owner: string;
  enable: boolean;
  scope: string;
  labels: Record<string, string>;
  bizTags: string[];
  metadata: Fields;
  versions: Version[];
  updateTime: number;
}
const resources: Resource[] = [];
let copilot: Fields = { apiKey: '', model: 'qwen-turbo', studioUrl: '', studioProject: '' };
const nameFields: Record<Kind, string> = {
  mcp: 'mcpName', agents: 'agentName', prompt: 'promptKey', skills: 'skillName', agentspecs: 'agentSpecName',
};
function object(value: unknown): Fields {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { throw new Error('JSON 格式无效'); }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
}
function array(value: unknown): unknown[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value || '[]') : value;
  if (!Array.isArray(parsed)) throw new Error('字段必须为 JSON 数组');
  return parsed;
}
function bodyFields(body: unknown): Fields {
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (typeof FormData !== 'undefined' && body instanceof FormData) return Object.fromEntries(body.entries());
  return body === undefined ? {} : object(body);
}
function page<T>(items: T[], p: Fields) {
  const pageSize = Math.max(1, Number(p.pageSize) || 10);
  const pageNo = Math.max(1, Number(p.pageNo) || 1);
  return { totalCount: items.length, pageNumber: pageNo, pageNo, pageSize,
    pagesAvailable: Math.ceil(items.length / pageSize), pageItems: items.slice((pageNo - 1) * pageSize, pageNo * pageSize) };
}
function summary(v: Version, r: Resource): Fields {
  return { version: v.version, status: v.status, promptKey: r.name, author: 'demo', srcUser: 'demo',
    commitMsg: v.commitMsg, description: v.commitMsg, changeDescription: v.commitMsg,
    createTime: v.updateTime, updateTime: v.updateTime, gmtModified: v.updateTime,
    publishPipelineInfo: v.publishPipelineInfo, downloadCount: 0,
    latest: r.labels.latest === v.version, labels: Object.keys(r.labels).filter((label) => r.labels[label] === v.version) };
}
function meta(r: Resource): Fields {
  const editingVersion = r.versions.find((v) => v.status === 'draft')?.version ?? null;
  const reviewingVersion = r.versions.find((v) => v.status === 'reviewing' || v.status === 'reviewed')?.version ?? null;
  const online = r.versions.filter((v) => v.status === 'online');
  return { ...r.metadata, namespaceId: r.namespaceId, name: r.name, agentName: r.name, promptKey: r.name,
    description: r.description, displayName: r.metadata.displayName || r.name, owner: r.owner,
    enable: r.enable, enabled: r.enable, status: r.enable ? 'enable' : 'disable', scope: r.scope,
    from: 'demo', labels: { ...r.labels }, latestVersion: r.labels.latest || '', editingVersion, reviewingVersion,
    onlineCnt: online.length, onlineCount: online.length, updateTime: r.updateTime, gmtModified: r.updateTime,
    bizTags: r.kind === 'prompt' ? r.bizTags : JSON.stringify(r.bizTags), bizTagsStr: JSON.stringify(r.bizTags),
    writable: true, downloadCount: 0, versionInfo: { editingVersion, reviewingVersion,
      labels: { ...r.labels }, onlineVersions: online.map((v) => summary(v, r)) } };
}
function detail(v: Version, r: Resource): Fields {
  const identity = { namespaceId: r.namespaceId, name: r.name, description: r.description };
  if (r.kind === 'skills' || r.kind === 'agentspecs') return { ...v.payload, ...identity };
  if (r.kind === 'mcp') return { ...meta(r), ...summary(v, r), namespaceId: r.namespaceId, mcpName: r.name,
    ...v.payload, labels: { ...r.labels }, resourceStatus: r.enable ? 'enable' : 'disable' };
  return { ...v.payload, ...identity, ...summary(v, r), agentName: r.name };
}
function payload(kind: Kind, p: Fields, fallback: Fields = {}): Fields {
  if (kind === 'prompt') return { ...fallback, template: String(p.template ?? fallback.template ?? ''),
    variables: p.variables === undefined ? fallback.variables || [] : array(p.variables), md5: 'demo-preview' };
  if (kind === 'skills' || kind === 'agentspecs') {
    const card = p[kind === 'skills' ? 'skillCard' : 'agentSpecCard'];
    return { resource: {}, ...fallback, ...(card === undefined ? {} : object(card)) };
  }
  if (kind === 'agents') return { ...fallback, callInterfaces: p.callInterfaces === undefined
    ? fallback.callInterfaces || [] : array(p.callInterfaces) };
  return { ...fallback,
    serverSpecification: p.serverSpecification === undefined ? fallback.serverSpecification || {} : object(p.serverSpecification),
    toolSpecification: p.toolSpecification === undefined ? fallback.toolSpecification || {} : object(p.toolSpecification),
    resourceSpecification: p.resourceSpecification === undefined ? fallback.resourceSpecification || {} : object(p.resourceSpecification) };
}
function updateLatest(r: Resource, preferred?: string) {
  const online = r.versions.filter((v) => v.status === 'online');
  const latest = preferred || online.map((v) => v.version).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1);
  if (latest) r.labels.latest = latest; else delete r.labels.latest;
}
function requireVersion(r: Resource, p: Fields): Version {
  const target = String(p.version || r.versions.find((v) => v.status === 'draft')?.version
    || r.versions.find((v) => v.status === 'reviewing' || v.status === 'reviewed')?.version || '');
  const v = r.versions.find((item) => item.version === target);
  if (!v) throw new Error('版本不存在');
  return v;
}
function working(r: Resource) {
  return r.versions.some((v) => ['draft', 'reviewing', 'reviewed'].includes(v.status));
}
function resultForMutation(r: Resource, v?: Version): unknown {
  if (r.kind === 'mcp' || r.kind === 'agents') return v ? detail(v, r) : meta(r);
  return r.kind === 'prompt' ? true : 'ok';
}
for (const kind of Object.keys(nameFields) as Kind[]) {
  const name = { mcp: 'demo-mcp', agents: 'demo-agent', prompt: 'demo-assistant', skills: 'demo-skill', agentspecs: 'demo-agent-spec' }[kind];
  const data: Fields = kind === 'prompt' ? { template: '请用简洁的语言回答：{{question}}', variables: [{ name: 'question', defaultValue: '', description: '用户问题' }] }
    : kind === 'skills' ? { skillMd: '---\nname: demo-skill\ndescription: 演示技能\n---\n\n# 演示技能\n\n整理问题并生成简洁答复。\n', resource: {} }
      : kind === 'agentspecs' ? { content: JSON.stringify({ name: 'demo-agent-spec', description: '演示 AgentSpec', version: '1.0.0' }, null, 2), resource: {} }
        : kind === 'mcp' ? { serverSpecification: { name, protocol: 'stdio', frontProtocol: 'stdio', enabled: true,
          description: '本地演示 MCP 服务', packages: [{ identifier: '@example/demo', registryType: 'npm', version: '1.0.0' }], capabilities: ['TOOL'] },
        toolSpecification: { tools: [{ name: 'summarize', description: '摘要示例，不执行调用', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }], toolsMeta: { summarize: { enabled: true } } } }
          : { callInterfaces: [{ protocol: 'A2A', protocolVersion: '0.3.0', descriptorMediaType: 'application/json',
            nativeDescriptor: { name, description: 'Agent 演示', skills: [] }, endpointSets: [{ source: 'DECLARED', endpoints: [] }] }] };
  const now = Date.now();
  resources.push({ kind, namespaceId: 'dev', name, description: '仅演示数据，可安全编辑', owner: 'demo', enable: true,
    scope: 'PRIVATE', labels: { latest: '1.0.0' }, bizTags: ['demo'], metadata: {}, updateTime: now,
    versions: [{ version: '1.0.0', status: 'online', payload: structuredClone(data), commitMsg: '演示初始版本', updateTime: now, publishPipelineInfo: null },
      { version: '1.1.0', status: 'draft', payload: structuredClone(data), commitMsg: '待编辑的演示草稿', updateTime: now, publishPipelineInfo: null }] });
}

/** Creates an uncompressed document bundle using browser primitives, without an archive dependency. */
function zipDocument(files: Record<string, string>): Blob {
  const records: Uint8Array<ArrayBuffer>[] = [];
  const directories: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [filename, content] of Object.entries(files)) {
    if (!filename || filename.startsWith('/') || filename.split(/[\\/]/).some((part) => part === '..')) throw new Error('资源文件路径无效');
    const name = new TextEncoder().encode(filename);
    const data = new TextEncoder().encode(content);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length);
    const local = new DataView(header.buffer);
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true); header.set(name, 30);
    const directory = new Uint8Array(46 + name.length);
    const central = new DataView(directory.buffer);
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
    central.setUint16(8, 0x800, true); central.setUint32(16, crc, true); central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true); central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true); directory.set(name, 46);
    records.push(header, data); directories.push(directory); offset += header.length + data.length;
  }
  const end = new Uint8Array(22);
  const trailer = new DataView(end.buffer);
  trailer.setUint32(0, 0x06054b50, true); trailer.setUint16(8, directories.length, true); trailer.setUint16(10, directories.length, true);
  trailer.setUint32(12, directories.reduce((size, entry) => size + entry.length, 0), true); trailer.setUint32(16, offset, true);
  return new Blob([...records, ...directories, end], { type: 'application/zip' });
}

/** Explicit demo mode only: all state stays in memory and no request can call external systems. */
export async function demoAiRequest<T>(path: string, params: Params = {}, method = 'GET', body?: unknown): Promise<T> {
  const p: Fields = { ...params, ...bodyFields(body) };
  const cleanPath = path.replace(/^\//, '').replace(/\/$/, '');
  if (cleanPath === 'v3/console/copilot/config') {
    if (method === 'POST') {
      copilot = Object.fromEntries(['apiKey', 'model', 'studioUrl', 'studioProject'].map((key) => [key, String(p[key] ?? copilot[key] ?? '')]));
      return true as T;
    }
    if (method === 'GET') return structuredClone(copilot) as T;
    throw new Error('演示模式不支持此 Copilot 操作');
  }
  const match = /^v3\/console\/ai\/(mcp|agents|prompt|skills|agentspecs)(?:\/(.*))?$/.exec(cleanPath);
  if (!match) throw new Error('演示模式不执行模型调用或外部网络请求');
  const kind = match[1] as Kind;
  const action = match[2] || '';
  const namespaceId = String(p.namespaceId || 'public');
  if (action.startsWith('upload') || action === 'importToolsFromMcp') throw new Error('演示模式不支持 ZIP 导入或远程工具拉取，请连接真实服务');
  const card = p.skillCard || p.agentSpecCard;
  const name = String(p[nameFields[kind]] || (card ? object(card).name : '') || '');
  let r = resources.find((item) => item.kind === kind && item.namespaceId === namespaceId && item.name === name);
  if (action === 'list' && method === 'GET') {
    const search = String(p[nameFields[kind]] || '');
    return structuredClone(page(resources.filter((item) => item.kind === kind && item.namespaceId === namespaceId
      && (p.search === 'accurate' ? item.name === search || !search : item.name.includes(search))
      && (!p.owner || item.owner === p.owner) && (!p.scope || item.scope === p.scope)
      && (!p.bizTag || item.bizTags.some((tag) => tag.includes(String(p.bizTag)))))
      .map((item) => kind === 'mcp' ? { ...object(item.versions.at(-1)?.payload.serverSpecification), ...meta(item),
        version: item.labels.latest, versionDetail: { version: item.labels.latest }, status: 'ACTIVE' } : meta(item)), p)) as T;
  }
  if (action === 'draft' && method === 'POST') {
    if (!name.trim()) throw new Error('资源名称不能为空');
    if (r && working(r)) throw new Error('已存在草稿或待处理审核版本');
    const version = String(p.version || p.targetVersion || `v${(r?.versions.length || 0) + 1}`);
    if (r?.versions.some((v) => v.version === version)) throw new Error('版本已存在');
    const based = p.basedOnVersion ? r?.versions.find((v) => v.version === p.basedOnVersion) : undefined;
    if (p.basedOnVersion && !based) throw new Error('来源版本不存在');
    const data = payload(kind, p, based?.payload);
    const now = Date.now();
    if (!r) {
      r = { kind, name, namespaceId, description: String(p.description || object(card).description || ''), owner: 'demo', enable: true,
        scope: 'PRIVATE', labels: {}, bizTags: [], metadata: {}, versions: [], updateTime: now };
      resources.push(r);
    }
    if (p.bizTags !== undefined) r.bizTags = array(p.bizTags).map(String);
    if (kind === 'agents') for (const key of ['displayName', 'iconUrl']) if (p[key] !== undefined) r.metadata[key] = p[key];
    const v: Version = { version, status: 'draft', payload: data, commitMsg: String(p.commitMsg || p.changeDescription || ''), updateTime: now, publishPipelineInfo: null };
    r.versions.push(v); r.updateTime = now;
    return structuredClone(kind === 'mcp' || kind === 'agents' ? detail(v, r) : version) as T;
  }
  if (!r) throw new Error('资源不存在或在当前命名空间不可见');
  let result: unknown;
  if (method === 'GET') {
    if (action === 'versions') result = page(r.versions.filter((v) => !p.status || v.status === p.status).map((v) => summary(v, r)), p);
    else if (action === 'version' || action === 'version/download') {
      const v = requireVersion(r, p);
      if (action === 'version/download') {
        if (kind === 'prompt') return new Blob([String(v.payload.template || '')], { type: 'text/markdown;charset=utf-8' }) as T;
        if (kind === 'skills' || kind === 'agentspecs') {
          const files: Record<string, string> = { [kind === 'skills' ? 'SKILL.md' : 'manifest.json']: String(v.payload[kind === 'skills' ? 'skillMd' : 'content'] || '') };
          for (const [path, entry] of Object.entries(object(v.payload.resource))) {
            if (path in files) throw new Error('资源文件不可覆盖主文档');
            files[path] = String(object(entry).content || '');
          }
          return zipDocument(files) as T;
        }
        throw new Error('此类型不支持下载');
      }
      result = detail(v, r);
    } else if (action === 'runtime-endpoints' && kind === 'agents') {
      const v = requireVersion(r, p);
      const callInterface = (v.payload.callInterfaces as Fields[]).find((item) => item.protocol === p.protocol);
      if (!callInterface) throw new Error('协议不存在');
      result = { runtimeEndpointSnapshot: { namespaceId, agentName: name, version: v.version,
        callInterface: { ...callInterface, endpointSets: [{ source: 'RUNTIME', endpoints: [] }] } },
      namingServiceRef: { namespaceId, groupName: 'demo', serviceName: 'demo-runtime' } };
    } else if (!action || action === 'governance') {
      if (kind === 'agents') result = { agent: meta(r), versionPage: page(r.versions.map((v) => summary(v, r)), { pageSize: 100 }) };
      else if (kind === 'mcp') {
        const v = r.versions.find((item) => item.version === (p.version || r.labels.latest));
        if (!v) throw new Error('没有可用的发布版本');
        result = { ...v.payload.serverSpecification as Fields, namespaceId, name, enabled: r.enable,
          toolSpec: v.payload.toolSpecification, resourceSpec: v.payload.resourceSpecification,
          frontendEndpoints: [], backendEndpoints: [], allVersions: r.versions.filter((item) => item.status === 'online').map((item) => ({ version: item.version })) };
      } else result = { ...meta(r), versions: kind === 'prompt' ? r.versions.map((v) => v.version) : r.versions.map((v) => summary(v, r)),
        versionDetails: r.versions.map((v) => summary(v, r)) };
    } else throw new Error(`演示模式不支持此读取操作：${action}`);
  } else if (method === 'DELETE') {
    if (action === 'draft') {
      const v = requireVersion(r, p);
      if (v.status !== 'draft') throw new Error('只能删除当前草稿');
      r.versions = r.versions.filter((item) => item !== v);
    } else if (!action) resources.splice(resources.indexOf(r), 1);
    else throw new Error('演示模式不支持此删除操作');
    result = resultForMutation(r);
  } else if (method === 'PUT') {
    if (action === 'draft') {
      const v = requireVersion(r, p);
      if (v.status !== 'draft') throw new Error('已冻结版本不能修改，请创建草稿或退回编辑');
      v.payload = payload(kind, p, v.payload);
      if ((kind === 'skills' || kind === 'agentspecs') && typeof v.payload.description === 'string') r.description = v.payload.description;
      v.commitMsg = String(p.commitMsg ?? p.changeDescription ?? v.commitMsg);
      v.updateTime = Date.now(); result = resultForMutation(r, v);
    } else if (action === 'labels') {
      const labels = object(p.labels);
      for (const [key, version] of Object.entries(labels)) {
        if (key === 'latest') continue;
        if (typeof version !== 'string' || !r.versions.some((v) => v.version === version && ['online', 'offline', 'reviewed'].includes(v.status))) throw new Error('标签必须指向有效的已冻结版本');
      }
      const latest = r.labels.latest;
      r.labels = Object.fromEntries(Object.entries(labels).filter(([key]) => key !== 'latest')) as Record<string, string>;
      updateLatest(r, latest);
      result = kind === 'mcp' ? r.labels : resultForMutation(r);
    } else if (action === 'scope') {
      if (!['PUBLIC', 'PRIVATE'].includes(String(p.scope))) throw new Error('可见范围无效');
      r.scope = String(p.scope); result = resultForMutation(r);
    } else if (action === 'biz-tags') { r.bizTags = array(p.bizTags).map(String); result = resultForMutation(r); }
    else if (action === 'description') { r.description = String(p.description || ''); result = resultForMutation(r); }
    else if (action === 'status' && kind === 'mcp') { r.enable = String(p.enabled) === 'true'; result = 'ok'; }
    else if (!action && kind === 'agents') {
      r.enable = p.status === 'enable'; r.description = String(p.description ?? r.description);
      for (const key of ['displayName', 'iconUrl', 'provider', 'tags', 'extensions']) if (p[key] !== undefined) {
        r.metadata[key] = ['provider', 'extensions'].includes(key) ? object(p[key]) : key === 'tags' ? array(p[key]) : p[key];
      }
      result = meta(r);
    } else throw new Error('演示模式不支持此更新操作');
    r.updateTime = Date.now();
  } else if (method === 'POST') {
    if ((action === 'online' || action === 'offline') && !p.version && (kind === 'skills' || kind === 'agentspecs')) {
      r.enable = action === 'online'; result = 'ok';
    } else {
      const v = requireVersion(r, p);
      if (action === 'submit') {
        if (!['draft', 'reviewing', 'reviewed'].includes(v.status)) throw new Error('当前版本不可提交审核');
        v.status = 'reviewed';
        v.publishPipelineInfo = JSON.stringify({ executionId: `demo-${Date.now()}`, status: 'APPROVED', pipeline: [{ nodeId: 'demo-review', passed: true, message: '仅演示：模拟审核通过，未调用模型或真实流水线' }] });
      } else if (action === 'redraft') {
        if (v.status !== 'reviewed' || r.versions.some((item) => item !== v && ['draft', 'reviewing', 'reviewed'].includes(item.status))) throw new Error('当前版本不可退回编辑');
        v.status = 'draft'; v.publishPipelineInfo = null;
      } else if (action === 'publish' || action === 'force-publish') {
        if (action === 'publish' ? v.status !== 'reviewed' || object(v.publishPipelineInfo).status !== 'APPROVED' : !['draft', 'reviewing', 'reviewed'].includes(v.status)) throw new Error('当前版本不满足发布条件');
        v.status = 'online'; updateLatest(r, v.version);
      } else if (action === 'online') {
        if (v.status !== 'offline') throw new Error('只能将已下线版本上线');
        v.status = 'online'; updateLatest(r, v.version);
      } else if (action === 'offline') {
        if (v.status !== 'online') throw new Error('只能将已上线版本下线');
        v.status = 'offline'; if (r.labels.latest === v.version) updateLatest(r);
      } else throw new Error('演示模式不支持此生命周期操作');
      v.updateTime = Date.now(); result = resultForMutation(r, v);
    }
    r.updateTime = Date.now();
  } else throw new Error('演示模式不支持此请求方式');
  return structuredClone(result) as T;
}
