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
import { api, request } from '../api';
import { readSession, SESSION_KEY } from '../session';
import type { Config, Page } from '../types';

const storage = new Map<string, string>();
const dispatch = vi.fn();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', { location: { origin: 'http://console.test' },
    CONSOLE_CONFIG: { apiBase: '/gateway/console-api/' }, dispatchEvent: dispatch });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ code: 0, data: [] }))));
  dispatch.mockClear();
});
function live() {
  storage.set(SESSION_KEY, JSON.stringify({ mode: 'live', accessToken: 'test-token', username: 'operator', globalAdmin: false }));
}
function respond(body: unknown, status = 200) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('Nacos console HTTP contract', () => {
  it('unwraps Result data and uses the explicit API base', async () => {
    respond({ code: 0, data: [{ namespace: 'namespace-id', namespaceShowName: 'Display Name' }] });
    expect(await api.namespaces()).toEqual([{ namespace: 'namespace-id', namespaceShowName: 'Display Name' }]);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('http://console.test/gateway/console-api/v3/console/core/namespace/list');
  });
  it('preserves flat login responses and sends passwords only in the form body', async () => {
    respond({ accessToken: 'new-token', username: 'operator', globalAdmin: true });
    const login = await api.login('operator', 'a+b& c');
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).not.toContain('password');
    expect((options?.body as URLSearchParams).get('password')).toBe('a+b& c');
    expect(login.accessToken).toBe('new-token');
  });
  it('sends both token headers and safely encodes namespace IDs, Data IDs and groupName', async () => {
    live();
    await api.config({ namespaceId: 'id +/中文', dataId: 'a+b.yaml', groupName: 'GROUP & ONE' });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get('namespaceId')).toBe('id +/中文');
    expect(parsed.searchParams.get('dataId')).toBe('a+b.yaml');
    expect(parsed.searchParams.get('groupName')).toBe('GROUP & ONE');
    expect(parsed.searchParams.get('username')).toBe('operator');
    expect(parsed.searchParams.has('group')).toBe(false);
    expect(new Headers(options?.headers).get('accessToken')).toBe('test-token');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-token');
  });
  it('preserves config metadata when publishing', async () => {
    await api.publish({ namespaceId: 'dev', dataId: 'a.yaml', groupName: 'DEFAULT_GROUP' },
      { dataId: 'a.yaml', groupName: 'DEFAULT_GROUP', content: 'enabled: true', type: 'yaml', appName: 'app', desc: 'description', configTags: 'tag-one' });
    const options = vi.mocked(fetch).mock.calls[0][1];
    expect(options?.method).toBe('POST');
    const body = options?.body as URLSearchParams;
    expect(body.get('namespaceId')).toBe('dev');
    expect(body.get('content')).toBe('enabled: true');
    expect(body.get('configTags')).toBe('tag-one');
    expect(body.get('appName')).toBe('app');
    expect(body.get('desc')).toBe('description');
  });
  it('uses nid for history detail and query parameters for deletion', async () => {
    const target = { namespaceId: 'dev', dataId: 'a.yaml', groupName: 'DEFAULT_GROUP' };
    await api.historyDetail(target, '123');
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('nid')).toBe('123');
    await api.deleteConfig(target);
    const [url, options] = vi.mocked(fetch).mock.calls[1];
    expect(options?.method).toBe('DELETE');
    expect(new URL(String(url)).searchParams.get('namespaceId')).toBe('dev');
  });
  it('keeps permission failures visible without logging the user out', async () => {
    live(); respond({ code: 403, message: 'access denied', data: 'authorization failed!' }, 403);
    await expect(api.namespaces()).rejects.toThrow('authorization failed!');
    expect(readSession()?.accessToken).toBe('test-token');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each([401, 200])('clears expired sessions even when the HTTP status is %s', async (status) => {
    live(); respond({ code: 403, message: 'access denied', data: 'token expired!' }, status);
    await expect(api.namespaces()).rejects.toThrow('token expired!');
    expect(readSession()).toBeNull();
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it('rejects business failures inside HTTP 200 responses', async () => {
    respond({ code: 400, message: 'configuration content is blank' });
    await expect(request('v3/console/cs/config')).rejects.toThrow('configuration content is blank');
  });
  it('does not switch failed live login to demonstration mode', async () => {
    respond({ code: 403, message: 'invalid credentials' }, 403);
    await expect(api.login('wrong', 'wrong')).rejects.toThrow('invalid credentials');
    expect(readSession()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('rejects malformed responses rather than displaying a successful empty table', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>proxy error</html>', { status: 502 }));
    await expect(api.namespaces()).rejects.toThrow('502');
  });
  it('clears an unauthorized session even when an intermediary returns HTML', async () => {
    live();
    vi.mocked(fetch).mockResolvedValue(new Response('<html>unauthorized</html>', { status: 401 }));
    await expect(api.namespaces()).rejects.toThrow('401');
    expect(readSession()).toBeNull();
  });
  it('times out a stalled connection and leaves the session available for retry', async () => {
    live();
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
      const result = expect(api.namespaces()).rejects.toThrow('请求超时');
      await vi.advanceTimersByTimeAsync(15000);
      await result;
      expect(readSession()?.username).toBe('operator');
    } finally { vi.useRealTimers(); }
  });
});

describe('isolated demonstration data', () => {
  it('supports config CRUD, history and namespace isolation without any network requests', async () => {
    storage.set(SESSION_KEY, JSON.stringify({ mode: 'demo', accessToken: 'demo-only', username: 'demo', globalAdmin: true }));
    const target = { namespaceId: 'dev', dataId: 'arco-test.yaml', groupName: 'TEST_GROUP' };
    const config: Config = { ...target, content: 'enabled: true', type: 'yaml', appName: 'test', configTags: 'preserved' };
    expect(await api.publish(target, config)).toBe(true);
    expect((await api.config(target)).content).toBe('enabled: true');
    const other = await api.configs({ namespaceId: 'test', dataId: target.dataId, groupName: '', pageNo: 1, pageSize: 10 });
    expect((other as Page<Config>).totalCount).toBe(0);
    await api.publish(target, { ...config, content: 'enabled: false' });
    expect((await api.history(target, 1)).totalCount).toBe(2);
    expect(await api.deleteConfig(target)).toBe(true);
    await expect(api.config(target)).rejects.toThrow('配置不存在');
    expect(fetch).not.toHaveBeenCalled();
  });
});
