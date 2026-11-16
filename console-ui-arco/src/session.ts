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
import type { RuntimeConfig, Session } from './types';

function directPreview() {
  return runtime().enableDemo
    && new URLSearchParams(window.location.search || '').get('preview') === 'demo';
}

export function runtime(): RuntimeConfig {
  const config = typeof window === 'undefined' ? {} : window.CONSOLE_CONFIG || {};
  return {
    name: config.name || '服务治理平台',
    apiBase: (config.apiBase || '/platform-api/').replace(/\/?$/, '/'),
    enableDemo: config.enableDemo !== false,
    enableAi: config.enableAi === true,
    enableCopilot: config.enableCopilot === true,
    storagePrefix: config.storagePrefix?.trim() || 'platform.console',
    legacyStoragePrefix: config.legacyStoragePrefix?.trim() || undefined,
  };
}

export function storageKey(suffix: string) {
  return `${runtime().storagePrefix}.${suffix}`;
}

export function sessionEvent() {
  return `${runtime().storagePrefix}.session-change`;
}

export function readStorage(suffix: string): string | null {
  const current = localStorage.getItem(storageKey(suffix));
  const { legacyStoragePrefix, storagePrefix } = runtime();
  if (current !== null || !legacyStoragePrefix || legacyStoragePrefix === storagePrefix) return current;
  const previousKey = `${legacyStoragePrefix}.${suffix}`;
  const previous = localStorage.getItem(previousKey);
  if (previous !== null) {
    localStorage.setItem(storageKey(suffix), previous);
    localStorage.removeItem(previousKey);
  }
  return previous;
}

export function writeStorage(suffix: string, value: string | null) {
  if (value === null) localStorage.removeItem(storageKey(suffix));
  else localStorage.setItem(storageKey(suffix), value);
  const { legacyStoragePrefix, storagePrefix } = runtime();
  if (legacyStoragePrefix && legacyStoragePrefix !== storagePrefix) localStorage.removeItem(`${legacyStoragePrefix}.${suffix}`);
}

export function readSession(): Session | null {
  if (directPreview()) {
    return { mode: 'demo', accessToken: 'demo-only', username: 'demo', globalAdmin: true };
  }
  try {
    const session: Session = JSON.parse(readStorage('session.v1') || 'null');
    return session && (session.mode === 'live' || session.mode === 'demo')
      && typeof session.accessToken === 'string' && session.accessToken
      && typeof session.username === 'string' ? session : null;
  } catch { return null; }
}

export function writeSession(session: Session | null) {
  if (!session && directPreview()) {
    const url = new URL(window.location.href);
    url.searchParams.delete('preview');
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new Event(sessionEvent()));
    return;
  }
  writeStorage('session.v1', session ? JSON.stringify(session) : null);
  window.dispatchEvent(new Event(sessionEvent()));
}
