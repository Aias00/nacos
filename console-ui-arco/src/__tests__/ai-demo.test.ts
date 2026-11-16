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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Params } from '../types';

type Fields = Record<string, unknown>;
let request: typeof import('../ai-demo').demoAiRequest;
const base = 'v3/console/ai/';
const prompt = { namespaceId: 'dev', promptKey: 'demo-assistant' };
const version = { ...prompt, version: '1.1.0' };
const get = <T = Fields>(path: string, params: Params = {}) => request<T>(base + path, params);
const post = <T = Fields>(path: string, params: Params = {}) => request<T>(base + path, params, 'POST');

beforeEach(async () => {
  vi.resetModules();
  request = (await import('../ai-demo')).demoAiRequest;
});
afterEach(() => vi.unstubAllGlobals());

describe('AI demo API contracts', () => {
  it('seeds native list and detail DTOs only in dev, without sharing namespace identities', async () => {
    for (const kind of ['mcp', 'agents', 'prompt', 'skills', 'agentspecs']) {
      const dev = await get<{ totalCount: number; pageItems: Fields[] }>(`${kind}/list`, { namespaceId: 'dev' });
      expect(dev.totalCount).toBe(1);
      expect(dev.pageItems[0].namespaceId).toBe('dev');
      for (const namespaceId of ['test', 'prod']) expect((await get<{ totalCount: number }>(`${kind}/list`, { namespaceId })).totalCount).toBe(0);
    }
    await expect(get('prompt/governance', { ...prompt, namespaceId: 'test' })).rejects.toThrow('不可见');
    expect(await get('mcp/version', { namespaceId: 'dev', mcpName: 'demo-mcp', version: '1.0.0' })).toMatchObject({ serverSpecification: { protocol: 'stdio' } });
    const agent = await get('agents', { namespaceId: 'dev', agentName: 'demo-agent' });
    expect(agent.agent).toMatchObject({ agentName: 'demo-agent' });
    expect(agent.versionPage).toMatchObject({ totalCount: 2 });
    expect(await get('skills/version', { namespaceId: 'dev', skillName: 'demo-skill', version: '1.0.0' })).toMatchObject({ name: 'demo-skill' });
  });

  it('enforces frozen versions, review gating, latest transitions and redraft constraints', async () => {
    await expect(request(base + 'prompt/draft', { ...prompt, version: '1.0.0', template: 'bad' }, 'PUT')).rejects.toThrow('冻结');
    await expect(post('prompt/publish', version)).rejects.toThrow('发布条件');
    await expect(post('prompt/draft', { ...prompt, targetVersion: '2.0.0' })).rejects.toThrow('已存在草稿');
    await request(base + 'prompt/draft', { ...version, template: 'Hello {{name}}', variables: '[{"name":"name"}]' }, 'PUT');
    await post('prompt/submit', version);
    expect(await get('prompt/version', version)).toMatchObject({ status: 'reviewed', template: 'Hello {{name}}' });
    await expect(request(base + 'prompt/draft', { ...version, template: 'changed' }, 'PUT')).rejects.toThrow('冻结');
    await post('prompt/redraft', version);
    expect(await get('prompt/version', version)).toMatchObject({ status: 'draft', publishPipelineInfo: null });
    await post('prompt/submit', version);
    await post('prompt/publish', version);
    expect(await get('prompt/governance', prompt)).toMatchObject({ labels: { latest: '1.1.0' }, onlineCnt: 2 });
    await expect(post('prompt/force-publish', version)).rejects.toThrow('发布条件');
    await expect(post('prompt/submit', version)).rejects.toThrow('不可提交');
    await post('prompt/offline', version);
    expect(await get('prompt/governance', prompt)).toMatchObject({ labels: { latest: '1.0.0' }, onlineCnt: 1 });
    await post('prompt/online', version);
    await request(base + 'prompt/labels', { ...prompt, labels: '{"latest":"bad","stable":"1.0.0"}' }, 'PUT');
    expect(await get('prompt/governance', prompt)).toMatchObject({ labels: { latest: '1.1.0', stable: '1.0.0' } });
  });

  it('creates isolated resources, updates JSON cards, filters metadata and deletes exact identity', async () => {
    const identity = { namespaceId: 'test', skillName: 'new-skill' };
    const card = JSON.stringify({ name: 'new-skill', description: 'a skill', skillMd: '# Skill', resource: {} });
    expect(await post('skills/draft', { ...identity, targetVersion: '1.0.0', skillCard: card })).toBe('1.0.0');
    expect(await get('skills/version', { ...identity, version: '1.0.0' })).toMatchObject({ name: 'new-skill', skillMd: '# Skill' });
    await request(base + 'skills/draft', { namespaceId: 'test', skillCard: JSON.stringify({ name: 'new-skill', skillMd: '# Changed' }) }, 'PUT');
    await request(base + 'skills/scope', { ...identity, scope: 'PUBLIC' }, 'PUT');
    expect(await get('skills/list', { namespaceId: 'test', scope: 'PUBLIC' })).toMatchObject({ totalCount: 1 });
    expect(await get('skills/list', { namespaceId: 'dev', skillName: 'new-skill' })).toMatchObject({ totalCount: 0 });
    await request(base + 'skills/draft', identity, 'DELETE');
    expect(await get('skills', identity)).toMatchObject({ editingVersion: null, versions: [] });
    await request(base + 'skills', identity, 'DELETE');
    await expect(get('skills', identity)).rejects.toThrow('不存在');
  });

  it.each([
    ['mcp', 'mcpName', 'demo-mcp'], ['agents', 'agentName', 'demo-agent'],
    ['skills', 'skillName', 'demo-skill'], ['agentspecs', 'agentSpecName', 'demo-agent-spec'],
  ])('honors the shared lifecycle and latest contract for %s', async (kind, key, name) => {
    const identity = { namespaceId: 'dev', [key]: name, version: '1.1.0' };
    await post(`${kind}/submit`, identity);
    const versions = await get<{ pageItems: Fields[] }>(`${kind}/versions`, identity);
    expect(versions.pageItems.find((item) => item.version === '1.1.0')).toMatchObject({ status: 'reviewed' });
    await post(`${kind}/publish`, identity);
    const detail = await get(`${kind}/version`, identity);
    if (kind === 'mcp') expect(detail.labels).toEqual({ latest: '1.1.0' });
    await post(`${kind}/offline`, identity);
    await expect(post(`${kind}/force-publish`, identity)).rejects.toThrow('发布条件');
    await post(`${kind}/online`, identity);
    await request(base + `${kind}/labels`, { ...identity, labels: '{"latest":"bad"}' }, 'PUT');
    const governance = await get(kind, { ...identity, version: undefined });
    expect(kind === 'agents' ? (governance.agent as Fields).versionInfo : kind === 'mcp'
      ? await get(`${kind}/version`, identity) : governance).toMatchObject({ labels: { latest: '1.1.0' } });
  });

  it('returns browser Blob downloads with correct formats', async () => {
    const md = await get<Blob>('prompt/version/download', { ...prompt, version: '1.0.0' });
    expect(md.type).toContain('text/markdown');
    expect(await md.text()).toContain('{{question}}');
    const archive = await get<Blob>('skills/version/download', { namespaceId: 'dev', skillName: 'demo-skill', version: '1.0.0' });
    const bytes = new Uint8Array(await archive.arrayBuffer());
    expect(archive.type).toBe('application/zip');
    expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    expect(new TextDecoder().decode(bytes)).toContain('SKILL.md');
  });

  it('never calls network, storage or inference; keeps Copilot keys in module memory only', async () => {
    const network = vi.fn(() => { throw new Error('unexpected network'); });
    const storage = { setItem: vi.fn(() => { throw new Error('unexpected persistent write'); }) };
    vi.stubGlobal('fetch', network);
    vi.stubGlobal('localStorage', storage);
    expect(await request('v3/console/copilot/config')).toMatchObject({ apiKey: '', model: 'qwen-turbo' });
    await request('v3/console/copilot/config', {}, 'POST', { apiKey: 'demo-only-value', model: 'demo-model' });
    expect(await request('v3/console/copilot/config')).toMatchObject({ apiKey: 'demo-only-value', model: 'demo-model' });
    await expect(request('v3/console/copilot/chat', {}, 'POST')).rejects.toThrow('不执行模型调用');
    await expect(get('mcp/importToolsFromMcp', { baseUrl: 'https://example.invalid' })).rejects.toThrow('不支持');
    await expect(post('skills/upload', { namespaceId: 'dev' })).rejects.toThrow('不支持');
    await get('agents/list', { namespaceId: 'dev' });
    expect(network).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.resetModules();
    const fresh = (await import('../ai-demo')).demoAiRequest;
    expect(await fresh('v3/console/copilot/config')).toMatchObject({ apiKey: '' });
  });
});
