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
import { Button, Card, Input, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import { api } from '../api';
import { useResource } from '../useResource';
import RequestError from '../RequestError';

export default function Cluster() {
  const [keyword, setKeyword] = useState('');
  const load = useCallback((signal: AbortSignal) => api.cluster(keyword, signal), [keyword]);
  const resource = useResource(load);
  return <div className="page-stack"><div className="page-heading"><Typography.Title heading={4}>集群管理</Typography.Title><Typography.Text type="secondary">查看集群成员与节点运行状态</Typography.Text></div>
    <Card bordered={false}><div className="table-toolbar"><Space><Input.Search aria-label="搜索节点 IP" placeholder="搜索节点 IP" searchButton="查询" onSearch={setKeyword} allowClear style={{ width: 300 }} /></Space>
      <Button icon={<IconRefresh />} onClick={resource.reload} loading={resource.loading}>刷新</Button></div><RequestError error={resource.error} retry={resource.reload} />
      <Table rowKey="address" loading={resource.loading} data={resource.data || []} pagination={false} scroll={{ x: 600 }} columns={[
        { title: '节点地址', dataIndex: 'address', render: (value) => <Typography.Text copyable>{value}</Typography.Text> },
        { title: 'IP 地址', dataIndex: 'ip' }, { title: '端口', dataIndex: 'port' },
        { title: '节点状态', dataIndex: 'state', render: (value) => <Tag color={value === 'UP' ? 'green' : 'red'}>{value}</Tag> },
      ]} /></Card></div>;
}
