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
import { Button, Card, Descriptions, Drawer, Form, Input, Message, Modal, Space, Switch, Table, Tabs, Tag, Typography } from '@arco-design/web-react';
import { IconRefresh, IconSearch } from '@arco-design/web-react/icon';
import { api } from '../api';
import { useConsole } from '../context';
import { useResource } from '../useResource';
import RequestError from '../RequestError';
import { showError } from '../utils';
import type { Instance, Page, Service, Subscriber } from '../types';

export default function Services({ subscribersOnly = false }: { subscribersOnly?: boolean }) {
  const { namespace } = useConsole();
  const [form] = Form.useForm();
  const [query, setQuery] = useState({ serviceNameParam: '', groupNameParam: '' });
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<Service | null>(null);
  const load = useCallback((signal: AbortSignal) => api.services({ ...query, namespaceId: namespace, pageNo: page, pageSize: 10 }, signal), [query, namespace, page]);
  const resource = useResource(load);
  return <div className="page-stack">
    <div className="page-heading"><Typography.Title heading={4}>{subscribersOnly ? '订阅者查询' : '服务列表'}</Typography.Title><Tag>Namespace · {namespace || 'public'}</Tag></div>
    <Card bordered={false}><Form form={form} layout="inline" className="filter-form" onSubmit={(values) => { setPage(1); setQuery({ serviceNameParam: values.serviceNameParam || '', groupNameParam: values.groupNameParam || '' }); }}>
      <Form.Item field="serviceNameParam" label="服务名称"><Input allowClear placeholder="搜索服务名称" style={{ width: 260 }} /></Form.Item>
      <Form.Item field="groupNameParam" label="Group"><Input allowClear placeholder="搜索 Group" style={{ width: 220 }} /></Form.Item>
      <Space><Button type="primary" htmlType="submit" icon={<IconSearch />}>查询</Button><Button onClick={() => { form.resetFields(); setQuery({ serviceNameParam: '', groupNameParam: '' }); setPage(1); }}>重置</Button></Space>
    </Form></Card>
    <Card bordered={false}><div className="table-toolbar"><Typography.Text>共 {resource.data?.totalCount ?? '—'} 个服务</Typography.Text>
      <Button icon={<IconRefresh />} onClick={resource.reload} loading={resource.loading}>刷新</Button></div><RequestError error={resource.error} retry={resource.reload} />
      <Table rowKey={(row) => row.groupName + '/' + row.name} loading={resource.loading} data={resource.data?.pageItems || []} scroll={{ x: 800 }}
        pagination={{ current: page, pageSize: 10, total: resource.data?.totalCount || 0, showTotal: true }} onChange={(value) => setPage(value.current || 1)}
        columns={[{ title: '服务名称', dataIndex: 'name', width: 260, render: (value, row) => <Button type="text" onClick={() => setTarget(row)}>{value}</Button> },
          { title: 'Group', dataIndex: 'groupName', width: 180 }, { title: '集群数', dataIndex: 'clusterCount' }, { title: '实例数', dataIndex: 'ipCount' },
          { title: '健康实例', dataIndex: 'healthyInstanceCount', render: (value, row) => <Tag color={value === row.ipCount ? 'green' : 'orange'}>{value} / {row.ipCount}</Tag> },
          { title: '操作', width: 140, render: (_, row) => <Button type="text" onClick={() => setTarget(row)}>{subscribersOnly ? '查看订阅者' : '查看详情'}</Button> }]} />
    </Card>
    <Drawer title={target?.name} visible={!!target} width="min(1050px, 100vw)" onCancel={() => setTarget(null)} footer={null} unmountOnExit>
      {target && <ServicePanel key={target.groupName + '/' + target.name} service={target} subscribersOnly={subscribersOnly} />}
    </Drawer>
  </div>;
}

function ServicePanel({ service, subscribersOnly }: { service: Service; subscribersOnly: boolean }) {
  const { namespace } = useConsole();
  const [tab, setTab] = useState(subscribersOnly ? 'subscribers' : 'instances');
  const [page, setPage] = useState(1);
  const target = { namespaceId: namespace, serviceName: service.name, groupName: service.groupName };
  const load = useCallback(async () => {
    const params = { namespaceId: namespace, serviceName: service.name, groupName: service.groupName, pageNo: page, pageSize: 10 };
    const [detail, rows] = await Promise.all([api.service(params), tab === 'instances' ? api.instances(params) : api.subscribers(params)]);
    return { detail, rows };
  }, [namespace, service.name, service.groupName, page, tab]);
  const resource = useResource(load);
  function toggle(row: Instance, enabled: boolean) {
    Modal.confirm({ title: enabled ? '确认上线此实例？' : '确认下线此实例？',
      content: `${service.name} · ${row.ip}:${row.port} · ${row.clusterName}`,
      okText: enabled ? '上线' : '下线', okButtonProps: { status: enabled ? undefined : 'warning' }, onOk: async () => {
        try {
          await api.updateInstance({ ...target, ip: row.ip, port: row.port, clusterName: row.clusterName,
            weight: row.weight, enabled, ephemeral: row.ephemeral, metadata: JSON.stringify(row.metadata || {}) });
          Message.success(enabled ? '实例已上线' : '实例已下线'); resource.reload();
        } catch (error) { showError(error); throw error; }
      } });
  }
  return <div className="page-stack">
    <Descriptions border column={{ xs: 1, md: 2 }} data={[{ label: '服务名称', value: service.name }, { label: 'Group', value: service.groupName },
      { label: '命名空间', value: namespace }, { label: '保护阈值', value: resource.data?.detail.protectThreshold ?? '—' }]} />
    <Tabs activeTab={tab} onChange={(key) => { setTab(key); setPage(1); }} extra={<Button icon={<IconRefresh />} loading={resource.loading} onClick={resource.reload}>刷新</Button>}>
      <Tabs.TabPane key="instances" title="实例列表" /><Tabs.TabPane key="subscribers" title="订阅者" />
    </Tabs>
    <RequestError error={resource.error} retry={resource.reload} />
    {tab === 'instances' ? <Table rowKey={(row) => `${row.ip}:${row.port}:${row.clusterName}`} loading={resource.loading}
      data={(resource.data?.rows as Page<Instance> | undefined)?.pageItems || []} scroll={{ x: 700 }}
      pagination={{ current: page, pageSize: 10, total: resource.data?.rows.totalCount || 0, showTotal: true }} onChange={(value) => setPage(value.current || 1)}
      columns={[{ title: 'IP 地址', dataIndex: 'ip' }, { title: '端口', dataIndex: 'port' }, { title: '集群', dataIndex: 'clusterName' },
        { title: '权重', dataIndex: 'weight' }, { title: '健康状态', dataIndex: 'healthy', render: (value) => <Tag color={value ? 'green' : 'red'}>{value ? '健康' : '异常'}</Tag> },
        { title: '实例类型', dataIndex: 'ephemeral', render: (value) => value ? '临时实例' : '持久实例' },
        { title: '是否上线', render: (_, row) => <Switch checked={row.enabled} checkedText="上线" uncheckedText="下线" aria-label={`${row.ip} 是否上线`} onChange={(checked) => toggle(row, checked)} /> }]} />
      : <Table rowKey={(row) => `${row.ip}:${row.port}`} loading={resource.loading} data={(resource.data?.rows as Page<Subscriber> | undefined)?.pageItems || []}
        pagination={{ current: page, pageSize: 10, total: resource.data?.rows.totalCount || 0, showTotal: true }} onChange={(value) => setPage(value.current || 1)}
        columns={[{ title: '客户端 IP', dataIndex: 'ip' }, { title: '端口', dataIndex: 'port' }, { title: '应用名称', dataIndex: 'appName', render: (value) => value || '—' }, { title: '客户端版本', dataIndex: 'agent' }]} />}
  </div>;
}
