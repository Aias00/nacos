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

export const SESSION_KEY = 'nacos.arco.session.v1';
export const SESSION_EVENT = 'nacos-arco-session-change';

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
  };
}

export function readSession(): Session | null {
  if (directPreview()) {
    return { mode: 'demo', accessToken: 'demo-only', username: 'demo', globalAdmin: true };
  }
  try {
    const session: Session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
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
    window.dispatchEvent(new Event(SESSION_EVENT));
    return;
  }
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}
