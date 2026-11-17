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
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Descriptions, Grid, Space, Statistic, Table, Tag, Typography } from '@arco-design/web-react';
import { IconArrowRight, IconRefresh } from '@arco-design/web-react/icon';
import { api } from '../api';
import { useConsole } from '../context';
import { useResource } from '../useResource';
import RequestError from '../RequestError';

export default function Overview() {
  const { namespace, namespaces, session } = useConsole();
  const navigate = useNavigate();
  const load = useCallback(async (signal: AbortSignal) => {
    const [configs, services, nodes] = await Promise.all([
      api.configs({ namespaceId: namespace, pageNo: 1, pageSize: 5, dataId: '', groupName: '', search: 'blur' }, signal),
      api.services({ namespaceId: namespace, pageNo: 1, pageSize: 5 }, signal),
      session.globalAdmin ? api.cluster('', signal) : Promise.resolve([]),
    ]);
    return { configs, services, nodes };
  }, [namespace, session.globalAdmin]);
  const resource = useResource(load);
  const current = namespaces.find((item) => item.namespace === namespace);
  return <div className="page-stack">
    <RequestError error={resource.error} retry={resource.reload} />
    <Grid.Row gutter={[20, 20]}>
      {[
        ['配置数量', resource.data?.configs.totalCount, '份'],
        ['服务数量', resource.data?.services.totalCount, '个'],
        [session.globalAdmin ? '集群节点' : '可见命名空间', session.globalAdmin ? resource.data?.nodes.length : namespaces.length, '个'],
      ].map(([title, value, suffix]) => <Grid.Col xs={24} md={8} key={String(title)}><Card className="overview-stat" bordered={false}>
        <Statistic title={String(title)} value={typeof value === 'number' ? value : '—'} suffix={suffix} loading={resource.loading} />
      </Card></Grid.Col>)}
    </Grid.Row>
    <Card title="当前空间" bordered={false} extra={<Button icon={<IconRefresh />} loading={resource.loading} onClick={resource.reload}>刷新</Button>}>
      <Descriptions column={{ xs: 1, md: 3 }} data={[
        { label: '命名空间', value: current?.namespaceShowName || namespace },
        { label: 'Namespace ID', value: <Typography.Text copyable>{namespace || 'public'}</Typography.Text> },
        { label: '当前账号', value: <Space>{session.username}<Tag color={session.globalAdmin ? 'arcoblue' : 'gray'}>{session.globalAdmin ? '管理员' : '普通用户'}</Tag></Space> },
      ]} />
    </Card>
    <Card title="配置概览" bordered={false} extra={<Button type="text" onClick={() => navigate('/configs')}>配置管理 <IconArrowRight /></Button>}>
      <Table rowKey="id" loading={resource.loading} data={resource.data?.configs.pageItems || []} pagination={false} scroll={{ x: 650 }}
        columns={[{ title: 'Data ID', dataIndex: 'dataId' }, { title: 'Group', dataIndex: 'groupName' },
          { title: '配置格式', dataIndex: 'type', render: (value) => <Tag>{String(value || 'text').toUpperCase()}</Tag> },
          { title: '归属应用', dataIndex: 'appName', render: (value) => value || '—' }]} />
    </Card>
    <Card title="服务概览" bordered={false} extra={<Button type="text" onClick={() => navigate('/services')}>服务管理 <IconArrowRight /></Button>}>
      <Table rowKey={(row) => row.groupName + '/' + row.name} loading={resource.loading} data={resource.data?.services.pageItems || []} pagination={false} scroll={{ x: 650 }}
        columns={[{ title: '服务名称', dataIndex: 'name' }, { title: 'Group', dataIndex: 'groupName' },
          { title: '实例数', dataIndex: 'ipCount' }, { title: '健康实例', dataIndex: 'healthyInstanceCount', render: (value) => <Tag color="green">{value}</Tag> }]} />
    </Card>
  </div>;
}
