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
import { request, requestBlob, requestUpload } from './api';
import type { Params } from './types';
import { pipelineState } from './components/ai/pipeline';

export type DocumentKind = 'prompt' | 'skill' | 'agentspec';
export interface DocumentTarget { kind: DocumentKind; namespaceId: string; name: string }
export interface DocumentVersion {
  version: string; status: string; commitMsg?: string; description?: string;
  author?: string; srcUser?: string; publishPipelineInfo?: unknown;
}
export interface DocumentSummary {
  name?: string; promptKey?: string; description?: string; owner?: string; scope?: string;
  enable?: boolean; writable?: boolean; labels?: Record<string, string>; latestVersion?: string;
  editingVersion?: string | null; reviewingVersion?: string | null; bizTags?: string | string[];
  onlineCnt?: number; versions?: DocumentVersion[] | string[]; versionDetails?: DocumentVersion[];
}
export interface DocumentCard {
  namespaceId?: string; name?: string; description?: string; content?: string; skillMd?: string;
  template?: string; variables?: PromptVariable[]; resource?: Record<string, DocumentFile>;
  commitMsg?: string;
}
export interface DocumentFile { name: string; type: string; content: string; metadata?: Record<string, unknown> | null }
export interface PromptVariable { name: string; defaultValue: string; description: string }
export interface UploadCheck {
  skillName?: string; precheckCode: string; reason?: string; targetVersion?: string;
  editingVersion?: string; owner?: string;
}
export const documentKinds = {
  prompt: { title: 'Prompt', base: 'v3/console/ai/prompt', nameKey: 'promptKey' },
  skill: { title: 'Skill', base: 'v3/console/ai/skills', nameKey: 'skillName' },
  agentspec: { title: 'AgentSpec', base: 'v3/console/ai/agentspecs', nameKey: 'agentSpecName' },
} as const;
/** Permit the explicit retry that normalizes a completed review whose callback did not finish. */
export function canSubmitDocument(writable: boolean, version?: DocumentVersion): boolean {
  if (!writable || !version) return false;
  if (['draft', 'reviewed'].includes(version.status)) return true;
  return version.status === 'reviewing' && ['APPROVED', 'REJECTED'].includes(pipelineState(version.publishPipelineInfo) || '');
}
/** Match the management UI policy: an administrator may bypass a current rejection only. */
export function canForcePublishDocument(globalAdmin: boolean, writable: boolean, version?: DocumentVersion): boolean {
  return globalAdmin && writable && !!version && ['reviewing', 'reviewed'].includes(version.status)
    && pipelineState(version.publishPipelineInfo) === 'REJECTED';
}
export function documentParams(target: DocumentTarget): Params {
  return { namespaceId: target.namespaceId, [documentKinds[target.kind].nameKey]: target.name };
}
export function documentName(row: DocumentSummary) { return row.promptKey || row.name || ''; }
export function documentVersions(meta: DocumentSummary): DocumentVersion[] {
  return meta.versionDetails || (meta.versions || []).filter((item): item is DocumentVersion => typeof item !== 'string');
}
export function customLabels(raw: string, versions: DocumentVersion[]): Record<string, string> {
  const labels: unknown = JSON.parse(raw);
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) throw new Error('标签必须是 JSON 对象');
  const result: Record<string, string> = Object.create(null);
  for (const [label, version] of Object.entries(labels)) {
    if (label === 'latest') continue;
    if (!label.trim() || typeof version !== 'string' || !versions.some((item) => item.version === version && ['online', 'offline', 'reviewed'].includes(item.status))) {
      throw new Error('自定义标签必须指向已审核或已发布的有效版本');
    }
    result[label] = version;
  }
  return result;
}
export function parseResources(raw: string): Record<string, DocumentFile> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资源文件必须是 JSON 对象');
  for (const file of Object.values(value)) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || typeof file.type !== 'string' || typeof file.content !== 'string') {
      throw new Error('每个资源文件需要 name、type、content 字符串字段');
    }
  }
  return value as Record<string, DocumentFile>;
}
export function parseVariables(raw: string): PromptVariable[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((item) => item && typeof item.name === 'string' && typeof item.defaultValue === 'string' && typeof item.description === 'string')) {
    throw new Error('变量必须是包含 name、defaultValue、description 的 JSON 数组');
  }
  return value;
}
export const documentsApi = {
  list: (kind: DocumentKind, params: Params, signal?: AbortSignal) => request<{totalCount: number; pageItems: DocumentSummary[]}>(`${documentKinds[kind].base}/list`, params, 'GET', signal),
  detail: (target: DocumentTarget, signal?: AbortSignal) => request<DocumentSummary>(`${documentKinds[target.kind].base}${target.kind === 'prompt' ? '/governance' : ''}`, documentParams(target), 'GET', signal),
  version: (target: DocumentTarget, version: string, signal?: AbortSignal) => request<DocumentCard>(`${documentKinds[target.kind].base}/version`, { ...documentParams(target), version }, 'GET', signal),
  mutate: (target: DocumentTarget, operation: string, params: Params = {}, method = 'POST') => request<unknown>(`${documentKinds[target.kind].base}${operation ? '/' + operation : ''}`, { ...params, ...documentParams(target) }, method),
  saveDraft: (target: DocumentTarget, card: DocumentCard, fresh: boolean, targetVersion?: string) => {
    const params: Params = target.kind === 'prompt' ? { template: card.template, variables: JSON.stringify(card.variables || []), commitMsg: card.commitMsg,
      ...(fresh ? { description: card.description, targetVersion } : {}) } : {
      [target.kind === 'skill' ? 'skillCard' : 'agentSpecCard']: JSON.stringify({ ...card, name: target.name, namespaceId: target.namespaceId }),
      ...(target.kind === 'skill' ? { commitMsg: card.commitMsg, ...(fresh ? { targetVersion } : {}) } : {}),
    };
    return documentsApi.mutate(target, 'draft', params, fresh && target.kind !== 'agentspec' ? 'POST' : 'PUT');
  },
  download: (target: DocumentTarget, version: string) => requestBlob(`${documentKinds[target.kind].base}/version/download`, { ...documentParams(target), version }),
  precheck: (namespaceId: string, file: File) => {
    const data = new FormData(); data.append('namespaceId', namespaceId); data.append('file', file, file.name);
    return requestUpload<UploadCheck[]>('v3/console/ai/skills/upload/precheck', data, 120000);
  },
  upload: (kind: 'skill' | 'agentspec', namespaceId: string, file: File, check?: UploadCheck) => {
    const data = new FormData(); data.append('namespaceId', namespaceId); data.append('file', file, file.name);
    if (kind === 'skill') {
      if (!check || !['READY', 'VERSION_ADJUSTED', 'DRAFT_EXISTS'].includes(check.precheckCode)) throw new Error('请先完成有效的单 Skill ZIP 预检');
      data.append('uploadAction', check.precheckCode === 'DRAFT_EXISTS' ? 'OVERWRITE_DRAFT' : 'CREATE_DRAFT');
      data.append('overwrite', String(check.precheckCode === 'DRAFT_EXISTS'));
    }
    return requestUpload<string>(`${documentKinds[kind].base}/upload`, data);
  },
};
