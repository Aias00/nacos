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
import { Message } from '@arco-design/web-react';
export function showError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  Message.error(error instanceof Error ? error.message : '操作失败，请稍后重试');
}
export function formatTime(value?: string) {
  if (!value) return '—';
  const timestamp = Number(value);
  const date = new Date(timestamp > 0 ? timestamp : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
