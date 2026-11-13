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

export function readConsoleBranding(
  source = typeof document === 'undefined'
    ? null
    : document.getElementById('console-branding')?.textContent
) {
  try {
    const value = JSON.parse(source || '{}');
    return {
      name: typeof value?.name === 'string' ? value.name : '',
      logo: typeof value?.logo === 'string' ? value.logo : '',
      showVersion: value?.showVersion !== false,
    };
  } catch {
    return { name: '', logo: '', showVersion: true };
  }
}

export const consoleBranding = readConsoleBranding();
