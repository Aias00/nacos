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
import { useCallback, useState } from 'react';
import { Button, Card, Table, Tabs, Tag, Typography } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import { api } from '../api';
import { useResource } from '../useResource';
import RequestError from '../RequestError';
import type { Page } from '../types';

export default function Access() {
  const [tab, setTab] = useState('users');
  const [page, setPage] = useState(1);
  const load = useCallback((): Promise<Page<Record<string, string>>> => tab === 'users' ? api.users(page) : tab === 'roles' ? api.roles(page) : api.permissions(page), [tab, page]);
  const resource = useResource(load);
  const columns = tab === 'users' ? [{ title: '用户名', dataIndex: 'username' }]
    : tab === 'roles' ? [{ title: '用户名', dataIndex: 'username' }, { title: '角色', dataIndex: 'role', render: (value: string) => <Tag color="arcoblue">{value}</Tag> }]
      : [{ title: '角色', dataIndex: 'role' }, { title: '资源', dataIndex: 'resource' }, { title: '权限', dataIndex: 'action', render: (value: string) => <Tag>{({ r: '只读', w: '写入', rw: '读写' } as Record<string, string>)[value] || value}</Tag> }];
  return <div className="page-stack"><div className="page-heading"><Typography.Title heading={4}>权限管理</Typography.Title><Tag>只读查询</Tag></div>
    <Card bordered={false}><Tabs activeTab={tab} onChange={(value) => { setTab(value); setPage(1); }} extra={<Button icon={<IconRefresh />} onClick={resource.reload} loading={resource.loading}>刷新</Button>}>
      <Tabs.TabPane key="users" title="用户列表" /><Tabs.TabPane key="roles" title="角色绑定" /><Tabs.TabPane key="permissions" title="角色权限" /></Tabs>
      <RequestError error={resource.error} retry={resource.reload} />
      <Table rowKey={(row) => [row.username, row.role, row.resource].join('/')} loading={resource.loading} data={resource.data?.pageItems || []} scroll={{ x: 650 }}
        columns={columns} pagination={{ current: page, pageSize: 10, total: resource.data?.totalCount || 0, showTotal: true }} onChange={(value) => setPage(value.current || 1)} />
    </Card></div>;
}
