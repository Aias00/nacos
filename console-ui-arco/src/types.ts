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
export interface Session {
  mode: 'live' | 'demo';
  accessToken: string;
  username: string;
  globalAdmin: boolean;
}
export interface RuntimeConfig { name: string; apiBase: string; enableDemo: boolean }
declare global { interface Window { CONSOLE_CONFIG?: Partial<RuntimeConfig> } }
export interface Namespace {
  namespace: string; namespaceShowName: string; namespaceDesc?: string;
  configCount: number; quota: number; type: number;
}
export interface Page<T> { totalCount: number; pageItems: T[]; pageNumber?: number }
export interface Config {
  id?: string; dataId: string; groupName: string; content: string; type: string;
  appName?: string; desc?: string; configTags?: string; md5?: string;
  createTime?: string; modifyTime?: string;
}
export interface ConfigTarget { namespaceId: string; dataId: string; groupName: string }
export interface History {
  id: string; dataId: string; groupName: string; content?: string; type?: string;
  srcUser: string; opType: string; modifiedTime?: string; modifyTime?: string; createdTime?: string;
}
export interface Service {
  name: string; groupName: string; clusterCount: number; ipCount: number; healthyInstanceCount: number;
}
export interface Instance {
  ip: string; port: number; clusterName: string; weight: number; enabled: boolean;
  healthy: boolean; ephemeral: boolean; metadata: Record<string, string>;
}
export interface ServiceDetail {
  serviceName: string; groupName: string; protectThreshold: number;
  metadata: Record<string, string>; ephemeral: boolean;
  clusterMap: Record<string, { hosts: Instance[] }>;
}
export interface ClusterNode { address: string; ip: string; port: number; state: string }
export interface Subscriber { ip: string; port: number; appName?: string; agent?: string; address?: string }
export type Params = Record<string, string | number | boolean | undefined>;
