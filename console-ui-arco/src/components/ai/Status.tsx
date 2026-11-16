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
import { Tag } from '@arco-design/web-react';
import { pipelineState } from './pipeline';

export function AiVersionTag({ status, pipeline }: { status: string; pipeline?: unknown }) {
  const labels: Record<string, [string, string]> = {
    draft: ['草稿', 'gray'], reviewing: ['审核中', 'orange'], reviewed: ['已审核', 'arcoblue'],
    online: ['已上线', 'green'], offline: ['已下线', 'gray'],
  };
  let [label, color] = Array.isArray(labels[status]) ? labels[status] : [status || '未知状态', 'gray'];
  if (status === 'reviewed' && pipelineState(pipeline) === 'REJECTED') {
    label = '审核拒绝'; color = 'red';
  } else if (status === 'reviewed' && pipelineState(pipeline) === 'APPROVED') {
    label = '待发布'; color = 'arcoblue';
  }
  return <Tag color={color}>{label}</Tag>;
}

export function AiResourceTag({ enabled }: { enabled: boolean | string | undefined }) {
  const on = enabled === true || enabled === 'enable' || enabled === 'enabled';
  const off = enabled === false || enabled === 'disable' || enabled === 'disabled';
  return <Tag color={on ? 'green' : 'gray'}>{on ? '已启用' : off ? '已停用' : '未设置'}</Tag>;
}

export function AiScopeTag({ scope }: { scope?: string }) {
  return <Tag color={scope === 'PRIVATE' ? 'orange' : 'arcoblue'}>
    {scope === 'PRIVATE' ? '私有' : scope === 'PUBLIC' ? '公开' : scope || '未设置'}
  </Tag>;
}
