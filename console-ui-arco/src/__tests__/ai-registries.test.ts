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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customLabels, draftPayload, initialDraft, mcpClientConfigs, registries, registryVersionActions, mcpManagementResource } from '../ai-registries';
import type { RegistryTarget } from '../ai-registries';
import { pipelineState } from '../components/ai/pipeline';
import { SESSION_KEY } from '../session';

const storage = new Map<string, string>();
const mcp: RegistryTarget = { kind: 'mcp', namespaceId: 'id +/中文', name: 'tools +/ops' };
const agent: RegistryTarget = { ...mcp, kind: 'agent', name: 'agent +/one' };
beforeEach(() => {
  storage.clear();
  storage.set(SESSION_KEY, JSON.stringify({ mode: 'live', accessToken: 'test-token', username: 'operator', globalAdmin: false }));
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('window', { location: { origin: 'http://console.test' }, CONSOLE_CONFIG: { apiBase: '/console-api/' }, dispatchEvent: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {} }))));
});
function sent(index = 0) {
  const [raw, options] = vi.mocked(fetch).mock.calls[index];
  return { url: new URL(String(raw)), options: options!, body: options?.body as URLSearchParams };
}

describe('AI registry wire contracts', () => {
  it('manages the first unpublished MCP draft using exact lifecycle metadata without a serving version', async () => {
    const detail = { version: '1.0.0', status: 'draft', writable: true,
      serverSpecification: { name: mcp.name, protocol: 'mcp-streamable', enabled: false, description: 'first draft' },
      resourceStatus: 'enable', owner: 'operator', scope: 'PRIVATE', labels: {}, editingVersion: '1.0.0' };
    vi.mocked(fetch).mockImplementation(async (raw) => {
      const url = new URL(String(raw));
      if (url.pathname.endsWith('/versions')) return new Response(JSON.stringify({ code: 0, data: { totalCount: 1, pageItems: [{ version: '1.0.0', status: 'draft' }] } }));
      if (url.pathname.endsWith('/version')) return new Response(JSON.stringify({ code: 0, data: detail }));
      return new Response(JSON.stringify({ code: 404, message: '没有可用的发布版本' }), { status: 404 });
    });
    const versions = await registries.versions(mcp);
    const exact = await registries.version(mcp, versions.pageItems[0].version);
    const resource = mcpManagementResource(mcp.name, exact);
    expect(resource).toMatchObject({ name: mcp.name, description: 'first draft', writable: true,
      status: 'enable', owner: 'operator', scope: 'PRIVATE', labels: {}, versionInfo: { editingVersion: '1.0.0' } });
    expect(resource.status).not.toBe(resource.enabled);
    expect(resource.writable).toBe(true);
    expect(exact.status).toBe('draft');
    expect(registryVersionActions(exact.status, null, false)).toContain('submit');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.every(([raw]) => /\/versions?$/.test(new URL(String(raw)).pathname))).toBe(true);
  });
  it('preserves a server refusal to edit unpublished MCP lifecycle metadata', () => {
    expect(mcpManagementResource('read-only', { version: '1.0.0', status: 'draft', writable: false,
      serverSpecification: { writable: true, name: 'untrusted-payload' }, resourceStatus: 'disable' }))
      .toMatchObject({ name: 'read-only', writable: false, status: 'disable' });
  });
  it('keeps namespace/name/version exact across version mutations and safely encodes form content', async () => {
    await registries.action(mcp, '1.2.0+build.1', 'force-publish');
    const { url, body, options } = sent();
    expect(url.pathname).toBe('/console-api/v3/console/ai/mcp/force-publish');
    expect(options.method).toBe('POST');
    expect(body.get('namespaceId')).toBe(mcp.namespaceId);
    expect(body.get('mcpName')).toBe(mcp.name);
    expect(body.get('version')).toBe('1.2.0+build.1');
    expect(body.has('updateLatestLabel')).toBe(false);
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-token');
  });
  it('reads MCP serving endpoints for the selected version, never implicitly latest', async () => {
    await registries.serving(mcp, '1.0.0');
    expect(sent().url.searchParams.get('version')).toBe('1.0.0');
    expect(sent().url.searchParams.get('mcpName')).toBe(mcp.name);
  });
  it('uses version-scoped Agent runtime reads and preserves backend Naming references', async () => {
    const result = { runtimeEndpointSnapshot: { callInterface: { protocol: 'a2a', endpointSets: [] } },
      namingServiceRef: { namespaceId: 'dev', groupName: 'nacos-agent', serviceName: 'server-generated-name' } };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: result })));
    expect(await registries.runtime(agent, '2.0.0', 'a2a')).toEqual(result);
    const { url } = sent();
    expect(url.pathname).toBe('/console-api/v3/console/ai/agents/runtime-endpoints');
    expect(Object.fromEntries(['namespaceId', 'agentName', 'version', 'protocol'].map((key) => [key, url.searchParams.get(key)])))
      .toEqual({ namespaceId: agent.namespaceId, agentName: agent.name, version: '2.0.0', protocol: 'a2a' });
  });
  it('deletes only the exact draft and never issues Naming service deletion', async () => {
    await registries.deleteDraft(agent, '2.1.0');
    const { url, options } = sent();
    expect(options.method).toBe('DELETE');
    expect(url.pathname).toBe('/console-api/v3/console/ai/agents/draft');
    expect(url.searchParams.get('version')).toBe('2.1.0');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('preserves all writable Agent metadata when toggling status', async () => {
    await registries.status(agent, false, { displayName: '展示名', description: '原描述', iconUrl: 'https://example.test/icon',
      status: 'enable', provider: { name: 'provider', url: 'https://example.test' }, tags: ['operations'], extensions: { custom: { preserved: true } }, owner: 'original-owner', scope: 'PRIVATE' });
    const { options, body } = sent();
    expect(options.method).toBe('PUT');
    expect(body.get('status')).toBe('disable');
    expect(body.get('displayName')).toBe('展示名');
    expect(JSON.parse(body.get('extensions')!)).toEqual({ custom: { preserved: true } });
    expect(JSON.parse(body.get('provider')!).name).toBe('provider');
    expect(body.get('tags')).toBe('["operations"]');
    expect(body.has('owner')).toBe(false);
    expect(body.has('scope')).toBe(false);
  });
  it('changes MCP enablement without rewriting versions and excludes latest from label replacement', async () => {
    await registries.status(mcp, false, {});
    expect(sent().url.pathname).toBe('/console-api/v3/console/ai/mcp/status');
    expect(sent().body.get('enabled')).toBe('false');
    await registries.labels(mcp, { latest: 'invalid-client-value', stable: '1.0.0' });
    expect(JSON.parse(sent(1).body.get('labels')!)).toEqual({ stable: '1.0.0' });
  });
  it('sends MCP draft complex fields as JSON strings in a form body', async () => {
    const fields = { ...initialDraft('mcp-one'), endpoint: 'https://mcp.test:9443/mcp?tenant=a%2Bb',
      tools: '{"tools":[{"name":"lookup","inputSchema":{"type":"object"}}]}' };
    const payload = draftPayload('mcp', fields, false, false);
    await registries.draft({ ...mcp, name: fields.name }, fields.version, payload);
    const { body, options } = sent();
    expect(options.method).toBe('POST');
    const server = JSON.parse(body.get('serverSpecification')!);
    expect(server.name).toBe('mcp-one');
    expect(server.version).toBe('1.0.0');
    expect(server.versionDetail.version).toBe('1.0.0');
    expect(server.remoteServerConfig.exportPath).toBe('/mcp?tenant=a%2Bb');
    expect(JSON.parse(body.get('endpointSpecification')!)).toEqual({ type: 'DIRECT', data: { address: 'mcp.test', port: '9443', transportProtocol: 'https' } });
    expect(JSON.parse(body.get('toolSpecification')!).tools[0].name).toBe('lookup');
  });
  it('preserves advanced MCP fields and private resource governance across draft edits', () => {
    const fields = initialDraft('existing', { version: '1.0.0', status: 'draft', serverSpecification: {
      protocol: 'http', frontProtocol: 'mcp-streamable', repository: { url: 'https://repo.test' },
      remoteServerConfig: { serviceRef: { namespaceId: 'dev', groupName: 'GROUP', serviceName: 'existing-service' } },
    }, toolSpecification: { tools: [], extensions: { custom: true } } });
    const payload = draftPayload('mcp', fields, true, true);
    expect(JSON.parse(String(payload.serverSpecification))).toMatchObject({ protocol: 'http', repository: { url: 'https://repo.test' }, remoteServerConfig: { serviceRef: { serviceName: 'existing-service' } } });
    expect(JSON.parse(String(payload.endpointSpecification))).toEqual({ type: 'REF', data: { namespaceId: 'dev', groupName: 'GROUP', serviceName: 'existing-service' } });
    expect(JSON.parse(String(payload.toolSpecification)).extensions).toEqual({ custom: true });
    expect(payload.scope).toBeUndefined();
  });
  it('omits first-creation-only Agent metadata for subsequent drafts and updates', () => {
    const fields = { ...initialDraft('existing'), description: 'must not overwrite', displayName: 'new display' };
    expect(draftPayload('agent', fields, false, false)).toMatchObject({ displayName: 'new display', description: 'must not overwrite' });
    for (const update of [true, false]) {
      const payload = draftPayload('agent', fields, update, true);
      expect(payload.callInterfaces).toBeDefined();
      expect(payload.displayName).toBeUndefined();
      expect(payload.description).toBeUndefined();
      expect(payload.basedOnVersion).toBeUndefined();
    }
  });
  it('rejects malformed JSON, invalid interfaces, credentials in URLs, and reserved label edits before writes', () => {
    const fields = initialDraft('test');
    expect(() => draftPayload('mcp', { ...fields, endpoint: 'https://mcp.test/mcp', tools: '[' }, false, false)).toThrow('工具定义');
    expect(() => draftPayload('agent', { ...fields, callInterfaces: '[]' }, false, false)).toThrow('非空数组');
    expect(() => draftPayload('mcp', { ...fields, endpoint: 'https://user:password@host/mcp' }, false, false)).toThrow('凭据');
    expect(() => customLabels('{"latest":"1.0.0"}')).toThrow('服务端维护');
    expect(() => customLabels('{"stable":2}')).toThrow('非空字符串');
    expect(() => customLabels('[]')).toThrow('JSON 对象');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([true, false])('preserves the exact managed endpoint reference for unchanged remote edits/forks (update=%s)', async (update) => {
    const source = { version: '1.0.0', status: update ? 'draft' : 'online', serverSpecification: {
      name: 'existing', version: '1.0.0', versionDetail: { version: '1.0.0', is_latest: !update },
      protocol: 'mcp-streamable', frontProtocol: 'mcp-streamable', enabled: true,
      remoteServerConfig: { exportPath: '/mcp', serviceRef: {
        namespaceId: 'id +/中文', groupName: 'mcp-endpoints', serviceName: 'existing::1.0.0', transportProtocol: 'https',
      } },
    } };
    const fields = initialDraft('existing', source);
    if (!update) fields.version = '1.1.0';
    expect(fields.endpoint).toBe('');
    await registries.draft({ ...mcp, name: 'existing' }, fields.version, draftPayload('mcp', fields, update, true), update);
    const { body, options } = sent();
    expect(options.method).toBe(update ? 'PUT' : 'POST');
    expect(JSON.parse(body.get('endpointSpecification')!)).toEqual({ type: 'REF', data: source.serverSpecification.remoteServerConfig.serviceRef });
    const specification = JSON.parse(body.get('serverSpecification')!);
    expect(specification.version).toBe(fields.version);
    expect(specification.versionDetail).toEqual({ ...source.serverSpecification.versionDetail, version: fields.version });
    expect(specification.remoteServerConfig).toEqual(source.serverSpecification.remoteServerConfig);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('refuses remote saves without a complete endpoint identity instead of inventing a service', () => {
    const fields = initialDraft('missing', { version: '1.0.0', status: 'draft', serverSpecification: {
      protocol: 'mcp-streamable', frontProtocol: 'mcp-streamable',
      remoteServerConfig: { serviceRef: { serviceName: 'incomplete' } },
    } });
    expect(() => draftPayload('mcp', fields, true, true)).toThrow('无法保留原 MCP Endpoint');
    expect(() => draftPayload('mcp', initialDraft('new'), false, false)).toThrow('必须填写 Endpoint');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('MCP client configuration routing', () => {
  it('prefers gateway frontend endpoints and never exposes HTTP backends as MCP URLs', () => {
    expect(mcpClientConfigs('gateway', { protocol: 'http', frontProtocol: 'mcp-streamable', backendEndpoints: [{ address: 'private-backend', port: 8080 }] })).toEqual([]);
    const configs = mcpClientConfigs('gateway', { protocol: 'http', frontendEndpoints: [{ protocol: 'https', address: 'gateway.test', port: 443, path: '/mcp' }], backendEndpoints: [{ address: 'private-backend', port: 8080 }] });
    expect(configs).toEqual([{ label: 'https://gateway.test/mcp', config: { mcpServers: { gateway: { url: 'https://gateway.test/mcp' } } } }]);
  });
  it('wraps stdio commands once and safely formats IPv6 remote endpoints', () => {
    const local = { command: 'node', args: ['server.js'], env: { REGION: 'dev' } };
    expect(mcpClientConfigs('local', { protocol: 'stdio', localServerConfig: local })[0].config).toEqual({ mcpServers: { local } });
    const wrapped = { mcpServers: { local } };
    expect(mcpClientConfigs('local', { protocol: 'stdio', localServerConfig: wrapped })[0].config).toEqual(wrapped);
    expect(mcpClientConfigs('remote', { protocol: 'mcp-sse', backendEndpoints: [{ protocol: 'mcp-sse', address: '::1', port: 8080, path: 'sse' }] })[0].label).toBe('http://[::1]:8080/sse');
  });
});

describe('Registry interrupted-review recovery', () => {
  it.each(['APPROVED', 'REJECTED'])('allows Submit recovery for reviewing with current %s result, keeps Publish for reviewed', (status) => {
    const current = pipelineState({ status });
    expect(registryVersionActions('reviewing', current, false)).toContain('submit');
    expect(registryVersionActions('reviewing', current, false)).not.toContain('publish');
    expect(registryVersionActions('reviewed', current, false).includes('publish')).toBe(status === 'APPROVED');
  });
  it('does not interpret historical or pending reviews as current terminal results', () => {
    for (const pipeline of [{ status: 'REJECTED', historical: true }, { status: 'APPROVED', historical: true }, { status: 'RUNNING' }]) {
      expect(registryVersionActions('reviewing', pipelineState(pipeline), true)).toEqual([]);
    }
    expect(registryVersionActions('reviewed', 'REJECTED', false)).not.toContain('force-publish');
    expect(registryVersionActions('reviewed', 'REJECTED', true)).toContain('force-publish');
    expect(registryVersionActions('draft', 'REJECTED', true)).not.toContain('force-publish');
  });
});
