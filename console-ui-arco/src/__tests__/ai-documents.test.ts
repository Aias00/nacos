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
import { canForcePublishDocument, canSubmitDocument, customLabels, documentParams, documentsApi, parseResources, parseVariables } from '../ai-documents';
import type { DocumentTarget } from '../ai-documents';
import { SESSION_KEY } from '../session';

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  storage.set(SESSION_KEY, JSON.stringify({ mode: 'live', accessToken: 'token', username: 'operator', globalAdmin: false }));
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('window', { location: { origin: 'https://console.test' }, CONSOLE_CONFIG: { apiBase: '/console-api/' }, dispatchEvent: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: 'ok' }))));
});
const target: DocumentTarget = { kind: 'prompt', namespaceId: 'dev +/中文', name: 'support + assistant' };
function call(index = 0) {
  const [url, options] = vi.mocked(fetch).mock.calls[index] as unknown as [URL, RequestInit];
  return { url: new URL(String(url)), options, body: options.body as URLSearchParams };
}
describe('AI document request contracts', () => {
  it.each(['prompt', 'skill', 'agentspec'] as const)('uses the %s resource identity and captures the requested version', async (kind) => {
    const captured = { ...target, kind };
    await documentsApi.version(captured, '1.2.3');
    const { url } = call();
    const key = kind === 'prompt' ? 'promptKey' : kind === 'skill' ? 'skillName' : 'agentSpecName';
    expect(url.searchParams.get('namespaceId')).toBe(target.namespaceId);
    expect(url.searchParams.get(key)).toBe(target.name);
    expect(url.searchParams.get('version')).toBe('1.2.3');
    expect(url.pathname).toBe('/console-api/v3/console/ai/' + (kind === 'prompt' ? 'prompt' : kind === 'skill' ? 'skills' : 'agentspecs') + '/version');
  });
  it('loads Prompt governance from the dedicated endpoint and filters lists on the server', async () => {
    await documentsApi.detail(target);
    expect(call().url.pathname).toBe('/console-api/v3/console/ai/prompt/governance');
    await documentsApi.list('skill', { namespaceId: 'dev', skillName: 'test', scope: 'PRIVATE', owner: 'operator', search: 'blur', pageNo: 3, pageSize: 20 });
    const params = call(1).url.searchParams;
    expect(Object.fromEntries(['namespaceId', 'skillName', 'scope', 'owner', 'search', 'pageNo', 'pageSize'].map((key) => [key, params.get(key)])))
      .toEqual({ namespaceId: 'dev', skillName: 'test', scope: 'PRIVATE', owner: 'operator', search: 'blur', pageNo: '3', pageSize: '20' });
  });
  it('serializes Prompt templates and variable definitions without corrupting form characters', async () => {
    const variables = [{ name: 'query', defaultValue: 'A+B & 中文', description: 'question' }];
    await documentsApi.saveDraft(target, { template: 'Answer {{query}} + & =', variables, description: 'support', commitMsg: 'first' }, true, '1.0.0');
    const { options, body } = call();
    expect(options.method).toBe('POST');
    expect(body.get('promptKey')).toBe(target.name);
    expect(body.get('namespaceId')).toBe(target.namespaceId);
    expect(body.get('template')).toBe('Answer {{query}} + & =');
    expect(JSON.parse(body.get('variables')!)).toEqual(variables);
    expect(body.get('targetVersion')).toBe('1.0.0');
    await documentsApi.saveDraft(target, { template: 'updated', variables }, false);
    expect(call(1).options.method).toBe('PUT');
    expect(call(1).body.has('targetVersion')).toBe(false);
  });
  it.each(['skill', 'agentspec'] as const)('binds the entire %s card to captured namespace/name while preserving empty resources', async (kind) => {
    const resource = { 'empty.txt': { name: 'empty.txt', type: 'text', content: '', metadata: null } };
    await documentsApi.saveDraft({ ...target, kind }, { name: 'incorrect', namespaceId: 'wrong', skillMd: '---\nname: test\n---', content: '{}', resource }, false);
    const { options, body } = call();
    expect(options.method).toBe('PUT');
    const card = JSON.parse(body.get(kind === 'skill' ? 'skillCard' : 'agentSpecCard')!);
    expect(card.name).toBe(target.name);
    expect(card.namespaceId).toBe(target.namespaceId);
    expect(card.resource).toEqual(resource);
    expect(body.has('setAsLatest')).toBe(false);
  });
  it('keeps lifecycle mutations scoped and never sends deprecated latest controls', async () => {
    await documentsApi.mutate(target, 'publish', { version: '1.2.3', namespaceId: 'wrong', promptKey: 'wrong' });
    const { options, body } = call();
    expect(options.method).toBe('POST');
    expect(body.get('promptKey')).toBe(target.name);
    expect(body.get('namespaceId')).toBe(target.namespaceId);
    expect(body.get('version')).toBe('1.2.3');
    expect(body.has('updateLatestLabel')).toBe(false);
    await documentsApi.mutate(target, 'draft', {}, 'DELETE');
    expect(call(1).options.method).toBe('DELETE');
    expect(call(1).url.searchParams.get('promptKey')).toBe(target.name);
  });
  it('uses the correct resource-level toggle scopes', async () => {
    for (const kind of ['skill', 'agentspec'] as const) await documentsApi.mutate({ ...target, kind }, 'offline', { scope: kind });
    expect(call().body.get('scope')).toBe('skill');
    expect(call(1).body.get('scope')).toBe('agentspec');
    expect(call().body.has('version')).toBe(false);
  });
  it('prechecks the original ZIP and uses an explicit overwrite action only for existing drafts', async () => {
    const file = new File(['zip'], 'skill.zip', { type: 'application/zip' });
    await documentsApi.precheck('dev', file);
    let [url, options] = vi.mocked(fetch).mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain('/skills/upload/precheck');
    let data = options.body as FormData;
    expect(data.get('namespaceId')).toBe('dev');
    expect((data.get('file') as File).name).toBe('skill.zip');
    expect(data.has('targetVersion')).toBe(false);
    await documentsApi.upload('skill', 'dev', file, { precheckCode: 'DRAFT_EXISTS', skillName: 'test' });
    [url, options] = vi.mocked(fetch).mock.calls[1] as unknown as [URL, RequestInit];
    data = options.body as FormData;
    expect(String(url)).toContain('/skills/upload');
    expect(data.get('uploadAction')).toBe('OVERWRITE_DRAFT');
    expect(data.get('overwrite')).toBe('true');
    expect(new Headers(options.headers).has('Content-Type')).toBe(false);
    expect(new Headers(options.headers).get('accessToken')).toBe('token');
  });
  it.each(['REVIEWING_EXISTS', 'NO_PERMISSION', 'INVALID_SKILL', 'UNKNOWN'])('blocks %s precheck results before upload', (precheckCode) => {
    expect(() => documentsApi.upload('skill', 'dev', new File(['zip'], 'a.zip'), { precheckCode })).toThrow('预检');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('downloads version bytes through the authenticated proxy path', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('PK-zip', { headers: { 'Content-Type': 'application/zip' } }));
    const blob = await documentsApi.download({ ...target, kind: 'skill' }, '1.2.3');
    expect(await blob.text()).toBe('PK-zip');
    const { url, options } = call();
    expect(url.pathname).toBe('/console-api/v3/console/ai/skills/version/download');
    expect(url.searchParams.get('skillName')).toBe(target.name);
    expect(url.searchParams.get('version')).toBe('1.2.3');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer token');
  });
});
describe('document editing boundaries', () => {
  it('preserves service-managed latest while validating custom labels against immutable versions', () => {
    const versions = [{ version: '1.0.0', status: 'online' }, { version: '2.0.0', status: 'draft' }];
    expect(customLabels('{"latest":"2.0.0","stable":"1.0.0"}', versions)).toEqual({ stable: '1.0.0' });
    expect(() => customLabels('{"stable":"2.0.0"}', versions)).toThrow('有效版本');
    expect(() => customLabels('{"stable":"missing"}', versions)).toThrow('有效版本');
    expect(() => customLabels('[]', versions)).toThrow('JSON 对象');
  });
  it('accepts empty resource content and rejects malformed resource/variable schemas', () => {
    const resource = { 'empty.txt': { name: 'empty.txt', type: 'text', content: '' } };
    expect(parseResources(JSON.stringify(resource))).toEqual(resource);
    expect(() => parseResources('{"a":{"content":null}}')).toThrow('content');
    expect(parseVariables('[]')).toEqual([]);
    expect(() => parseVariables('[{"name":"query"}]')).toThrow('变量');
    expect(documentParams({ ...target, kind: 'agentspec' })).toEqual({ namespaceId: target.namespaceId, agentSpecName: target.name });
  });
});


describe('document force-publish management policy', () => {
  it.each(['reviewing', 'reviewed'])('allows an administrator to bypass only a current rejection in %s', (status) => {
    expect(canForcePublishDocument(true, true, { version: '1.0.0', status, publishPipelineInfo: { status: 'REJECTED' } })).toBe(true);
  });
  it.each(['draft', 'online', 'offline'])('does not expose bypass for %s even with a rejected result', (status) => {
    expect(canForcePublishDocument(true, true, { version: '1.0.0', status, publishPipelineInfo: { status: 'REJECTED' } })).toBe(false);
  });
  it('denies non-administrators and read-only resources independently of pipeline state', () => {
    const rejected = { version: '1.0.0', status: 'reviewed', publishPipelineInfo: '{"status":"REJECTED"}' };
    expect(canForcePublishDocument(false, true, rejected)).toBe(false);
    expect(canForcePublishDocument(true, false, rejected)).toBe(false);
    expect(canForcePublishDocument(true, true)).toBe(false);
  });
  it.each([undefined, '{invalid', { status: 'APPROVED' }, { status: 'IN_PROGRESS' }, { status: 'REJECTED', historical: true }])('does not authorize bypass using absent, invalid, approved, active or historical pipeline data: %s', (publishPipelineInfo) => {
    expect(canForcePublishDocument(true, true, { version: '1.0.0', status: 'reviewed', publishPipelineInfo })).toBe(false);
  });
});


describe('document review recovery', () => {
  it.each(['draft', 'reviewed'])('permits writable %s versions to enter or reenter review', (status) => {
    expect(canSubmitDocument(true, { version: '1.0.0', status })).toBe(true);
  });
  it.each(['APPROVED', 'REJECTED'])('offers a retry for reviewing versions with current %s results', (status) => {
    expect(canSubmitDocument(true, { version: '1.0.0', status: 'reviewing', publishPipelineInfo: JSON.stringify({ status }) })).toBe(true);
  });
  it.each([undefined, '{bad', { status: 'IN_PROGRESS' }, { status: 'APPROVED', historical: true }, { status: 'REJECTED', historical: true }])('does not restart active/unknown or historical review results: %s', (publishPipelineInfo) => {
    expect(canSubmitDocument(true, { version: '1.0.0', status: 'reviewing', publishPipelineInfo })).toBe(false);
  });
  it('prevents resubmission of online/offline and read-only versions', () => {
    for (const status of ['online', 'offline']) expect(canSubmitDocument(true, { version: '1.0.0', status, publishPipelineInfo: { status: 'APPROVED' } })).toBe(false);
    expect(canSubmitDocument(false, { version: '1.0.0', status: 'reviewing', publishPipelineInfo: { status: 'REJECTED' } })).toBe(false);
    expect(canSubmitDocument(true)).toBe(false);
  });
});
