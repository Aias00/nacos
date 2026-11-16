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
import { readSession, readStorage, runtime, sessionEvent, storageKey, writeSession, writeStorage } from '../session';
import type { Session } from '../types';

const storage = new Map<string, string>();
const dispatch = vi.fn();
const account: Session = { mode: 'live', accessToken: 'existing-token', username: 'operator + 中文', globalAdmin: false };
beforeEach(() => {
  storage.clear(); dispatch.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', { CONSOLE_CONFIG: {}, location: { origin: 'https://console.test', search: '', href: 'https://console.test/' }, dispatchEvent: dispatch });
});
afterEach(() => vi.unstubAllGlobals());

describe('local feature display flags', () => {
  it('keeps optional AI and Copilot pages closed by default in live and demo modes', () => {
    expect(runtime()).toMatchObject({ enableAi: false, enableCopilot: false });
    writeSession(account);
    expect(runtime()).toMatchObject({ enableAi: false, enableCopilot: false });
    window.location.search = '?preview=demo';
    expect(readSession()?.mode).toBe('demo');
    expect(runtime()).toMatchObject({ enableAi: false, enableCopilot: false });
  });
  it('requires explicit boolean true rather than truthy strings or numbers', () => {
    for (const value of ['true', 'false', 'TRUE', 1, 0, null]) {
      window.CONSOLE_CONFIG = JSON.parse(JSON.stringify({ enableAi: value, enableCopilot: value }));
      expect(runtime()).toMatchObject({ enableAi: false, enableCopilot: false });
    }
    window.CONSOLE_CONFIG = { enableAi: true, enableCopilot: true };
    expect(runtime()).toMatchObject({ enableAi: true, enableCopilot: true });
  });
  it('allows independent display flags without using server capability fields', () => {
    window.CONSOLE_CONFIG = JSON.parse('{"enableAi":true,"ai_enabled":false,"copilot_enabled":true,"function_mode":"naming"}');
    expect(runtime()).toMatchObject({ enableAi: true, enableCopilot: false });
    window.CONSOLE_CONFIG = { enableCopilot: true };
    expect(runtime()).toMatchObject({ enableAi: false, enableCopilot: true });
  });
});

describe('configurable browser storage', () => {
  it('uses neutral defaults and keeps configured installations isolated', () => {
    expect(runtime().storagePrefix).toBe('platform.console');
    writeSession(account);
    expect(storage.get('platform.console.session.v1')).toBe(JSON.stringify(account));
    expect(dispatch.mock.calls[0][0].type).toBe('platform.console.session-change');
    window.CONSOLE_CONFIG = { storagePrefix: 'another.console' };
    expect(readSession()).toBeNull();
    expect(sessionEvent()).toBe('another.console.session-change');
    expect(storageKey('theme')).toBe('another.console.theme');
  });
  it('does not discover or adopt unrelated old sessions unless migration is configured', () => {
    storage.set('nacos.arco.session.v1', JSON.stringify(account));
    expect(readSession()).toBeNull();
    expect(storage.has('nacos.arco.session.v1')).toBe(true);
    expect(storage.has('platform.console.session.v1')).toBe(false);
  });
  it('migrates the configured session and exact account/mode preferences once', () => {
    window.CONSOLE_CONFIG = { storagePrefix: 'workspace', legacyStoragePrefix: 'nacos.arco' };
    const suffix = `namespace.live.${encodeURIComponent(account.username)}`;
    storage.set('nacos.arco.session.v1', JSON.stringify(account));
    storage.set(`nacos.arco.${suffix}`, 'namespace-id');
    storage.set('nacos.arco.namespace.live.other', 'other-id');
    storage.set(`nacos.arco.namespace.demo.${encodeURIComponent(account.username)}`, 'demo-id');
    storage.set('nacos.arco.theme', 'dark');
    expect(readSession()).toEqual(account);
    expect(readStorage(suffix)).toBe('namespace-id');
    expect(readStorage('theme')).toBe('dark');
    expect(storage.get(`workspace.${suffix}`)).toBe('namespace-id');
    expect(storage.has('nacos.arco.session.v1')).toBe(false);
    expect(storage.has(`nacos.arco.${suffix}`)).toBe(false);
    expect(storage.has('nacos.arco.theme')).toBe(false);
    expect(storage.get('nacos.arco.namespace.live.other')).toBe('other-id');
    expect(storage.get(`nacos.arco.namespace.demo.${encodeURIComponent(account.username)}`)).toBe('demo-id');
  });
  it('retains current-prefix values instead of overwriting with stale legacy data', () => {
    window.CONSOLE_CONFIG = { legacyStoragePrefix: 'previous' };
    storage.set('previous.session.v1', JSON.stringify({ ...account, username: 'stale-account' }));
    storage.set(storageKey('session.v1'), JSON.stringify(account));
    storage.set('previous.theme', 'dark');
    storage.set(storageKey('theme'), '');
    expect(readSession()).toEqual(account);
    expect(readStorage('theme')).toBe('');
  });
  it('removes both session locations on logout so an old session cannot return', () => {
    window.CONSOLE_CONFIG = { legacyStoragePrefix: 'previous' };
    storage.set('previous.session.v1', JSON.stringify(account));
    storage.set(storageKey('session.v1'), JSON.stringify(account));
    writeSession(null);
    expect(readSession()).toBeNull();
    expect(storage.has('previous.session.v1')).toBe(false);
    expect(storage.has(storageKey('session.v1'))).toBe(false);
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it('keeps login and preference writes under the current prefix and clears stale counterparts', () => {
    window.CONSOLE_CONFIG = { legacyStoragePrefix: 'previous' };
    storage.set('previous.session.v1', 'invalid-old-session');
    storage.set('previous.theme', 'light');
    writeSession(account);
    writeStorage('theme', 'dark');
    expect(readSession()).toEqual(account);
    expect(readStorage('theme')).toBe('dark');
    expect(storage.has('previous.session.v1')).toBe(false);
    expect(storage.has('previous.theme')).toBe(false);
  });
  it('treats an identical migration prefix as current storage without deleting it', () => {
    window.CONSOLE_CONFIG = { storagePrefix: 'workspace', legacyStoragePrefix: 'workspace' };
    writeSession(account);
    expect(readSession()).toEqual(account);
    expect(storage.has('workspace.session.v1')).toBe(true);
  });
  it('keeps the real legacy session untouched during preview and restores it on leaving', () => {
    window.CONSOLE_CONFIG = { legacyStoragePrefix: 'previous' };
    storage.set('previous.session.v1', JSON.stringify(account));
    window.location.search = '?preview=demo';
    window.location.href = 'https://console.test/?preview=demo#/overview';
    Object.defineProperty(window, 'history', { value: { replaceState: () => { window.location.search = ''; } }, configurable: true });
    expect(readSession()?.mode).toBe('demo');
    expect(storage.has('platform.console.session.v1')).toBe(false);
    expect(storage.has('previous.session.v1')).toBe(true);
    writeSession(null);
    expect(readSession()).toEqual(account);
    expect(storage.has('previous.session.v1')).toBe(false);
  });
});
