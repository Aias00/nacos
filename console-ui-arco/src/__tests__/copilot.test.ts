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
import { clearsCopilotKey, copilotApi, prepareCopilotUpdate, readCopilotConfig } from '../copilot-api';
import { SESSION_KEY } from '../session';

const storage = new Map<string, string>();
const writes = vi.fn();
beforeEach(() => {
  storage.clear(); writes.mockClear();
  storage.set(SESSION_KEY, JSON.stringify({ mode: 'live', username: 'admin', accessToken: 'session-token', globalAdmin: true }));
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: writes, removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('window', { location: { origin: 'https://console.test' }, CONSOLE_CONFIG: { apiBase: '/gateway/console-api/' }, dispatchEvent: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: true }))));
});
const original = { apiKey: 'secret-api-key', model: 'qwen-turbo', studioUrl: 'https://studio.example.test/project', studioProject: 'Existing Studio Project' };
describe('Copilot API contract', () => {
  it('reads platform configuration without sending namespace or secrets in the URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { ...original, enabled: true, defaultNamespace: 'public' } })));
    expect(await copilotApi.get()).toEqual(original);
    const [url, options] = vi.mocked(fetch).mock.calls[0] as unknown as [URL, RequestInit];
    expect(new URL(String(url)).pathname).toBe('/gateway/console-api/v3/console/copilot/config');
    expect(new URL(String(url)).searchParams.has('namespaceId')).toBe(false);
    expect(String(url)).not.toContain(original.apiKey);
    expect(options.method).toBe('GET');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer session-token');
    expect(writes).not.toHaveBeenCalled();
  });
  it('saves exactly the supported four fields as authenticated JSON and preserves hidden Studio values', async () => {
    const config = prepareCopilotUpdate(original, { model: 'qwen-plus' });
    await copilotApi.save(config);
    const [url, options] = vi.mocked(fetch).mock.calls[0] as unknown as [URL, RequestInit];
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(options.headers).get('accessToken')).toBe('session-token');
    expect(JSON.parse(String(options.body))).toEqual({ ...original, model: 'qwen-plus' });
    expect(new URL(String(url)).searchParams.has('namespaceId')).toBe(false);
    expect(new URL(String(url)).searchParams.has('apiKey')).toBe(false);
    expect(String(url)).not.toContain(original.apiKey);
    expect(writes).not.toHaveBeenCalled();
  });
  it('keeps failed reads as errors instead of returning an editable empty configuration', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: 403, message: 'access denied' }), { status: 403 }));
    await expect(copilotApi.get()).rejects.toThrow('access denied');
    expect(fetch).toHaveBeenCalledOnce();
    expect(writes).not.toHaveBeenCalled();
  });
  it('rejects a false persistence result', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: false })));
    await expect(copilotApi.save(original)).rejects.toThrow('未保存成功');
  });
  it('round-trips the same supported configuration in explicit demo mode without network or persistent secrets', async () => {
    storage.set(SESSION_KEY, JSON.stringify({ mode: 'demo', username: 'demo', accessToken: 'demo-only', globalAdmin: true }));
    await copilotApi.save(original);
    expect(await copilotApi.get()).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });
});
describe('Copilot editing boundaries', () => {
  it('represents a missing key as unconfigured and retains server defaults', () => {
    expect(readCopilotConfig({ apiKey: null, model: 'qwen-turbo', studioProject: 'NacosCopilot' })).toEqual({ apiKey: '', model: 'qwen-turbo', studioProject: 'NacosCopilot' });
    expect(readCopilotConfig({})).toEqual({ apiKey: '', model: 'qwen-turbo' });
  });
  it('retains unedited null and absent advanced settings rather than inventing or clearing them', () => {
    const config = { apiKey: 'key', model: 'qwen-turbo', studioUrl: null };
    expect(prepareCopilotUpdate(config, { apiKey: 'replacement' })).toEqual({ ...config, apiKey: 'replacement' });
    expect(prepareCopilotUpdate(original, { studioProject: '' }).studioProject).toBe('');
    expect(prepareCopilotUpdate(original, { studioUrl: '' }).studioUrl).toBe('');
  });
  it('recognizes key clearing separately from replacement and an already empty key', () => {
    expect(clearsCopilotKey(original, { ...original, apiKey: '  ' })).toBe(true);
    expect(clearsCopilotKey(original, { ...original, apiKey: 'replacement' })).toBe(false);
    expect(clearsCopilotKey({ ...original, apiKey: '' }, { ...original, apiKey: '' })).toBe(false);
  });
  it.each(['javascript:alert(1)', 'data:text/plain,test', 'ftp://studio.example.test', '/relative/studio', 'not-a-url'])('rejects invalid Studio URL %s', (studioUrl) => {
    expect(() => prepareCopilotUpdate(original, { studioUrl })).toThrow('HTTP 或 HTTPS');
  });
  it('accepts HTTP(S) Studio endpoints and account-specific model names without a fabricated model catalogue', () => {
    expect(prepareCopilotUpdate(original, { studioUrl: 'http://localhost:3000', model: ' qwen-account-model ' }).model).toBe('qwen-account-model');
    expect(() => prepareCopilotUpdate(original, { model: '  ' })).toThrow('Qwen 模型');
  });
  it('rejects malformed configuration responses without including credential values in errors', () => {
    for (const value of [null, [], 'secret-api-key', { apiKey: { secret: 'do-not-print' } }]) {
      expect(() => readCopilotConfig(value)).toThrow('响应');
    }
  });
});
