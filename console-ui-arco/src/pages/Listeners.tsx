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
import { Button, Card, Empty, Form, Input, Radio, Table, Tag, Typography } from '@arco-design/web-react';
import { IconSearch } from '@arco-design/web-react/icon';
import { api } from '../api';
import { useConsole } from '../context';
import { useResource } from '../useResource';
import RequestError from '../RequestError';
import type { Params } from '../types';

export default function Listeners() {
  const { namespace } = useConsole();
  const [form] = Form.useForm();
  const [mode, setMode] = useState('config');
  const [query, setQuery] = useState<Params | null>(null);
  const load = useCallback(() => query ? api.listeners({ ...query, namespaceId: namespace }, mode === 'ip')
    : Promise.resolve({ listenersStatus: {} }), [query, namespace, mode]);
  const resource = useResource(load);
  const rows = Object.entries(resource.data?.listenersStatus || {}).map(([key, md5]) => ({ key, md5 }));
  return <div className="page-stack">
    <div className="page-heading"><Typography.Title heading={4}>监听查询</Typography.Title><Tag>Namespace · {namespace || 'public'}</Tag></div>
    <Card bordered={false}><Radio.Group type="button" value={mode} onChange={(value) => { setMode(value); setQuery(null); form.resetFields(); }} style={{ marginBottom: 24 }}>
      <Radio value="config">按配置查询</Radio><Radio value="ip">按 IP 查询</Radio></Radio.Group>
      <Form form={form} layout="inline" className="filter-form" initialValues={{ groupName: 'DEFAULT_GROUP' }} onSubmit={setQuery}>
        {mode === 'config' ? <><Form.Item label="Data ID" field="dataId" rules={[{ required: true, match: /\S/ }]}><Input placeholder="请输入完整 Data ID" style={{ width: 260 }} /></Form.Item>
          <Form.Item label="Group" field="groupName" rules={[{ required: true, match: /\S/ }]}><Input style={{ width: 220 }} /></Form.Item></>
          : <Form.Item label="IP 地址" field="ip" rules={[{ required: true, match: /\S/ }]}><Input placeholder="例如 10.0.0.11" style={{ width: 260 }} /></Form.Item>}
        <Button type="primary" htmlType="submit" icon={<IconSearch />}>查询</Button>
      </Form></Card>
    <Card bordered={false}><RequestError error={resource.error} retry={resource.reload} />
      {!query ? <Empty description="输入查询条件，查看配置监听关系" /> : <Table rowKey="key" loading={resource.loading} data={rows} scroll={{ x: 600 }} pagination={{ pageSize: 10, showTotal: true }}
        columns={[{ title: mode === 'config' ? '监听客户端 IP' : '配置 / Group', dataIndex: 'key' }, { title: 'MD5', dataIndex: 'md5', render: (value) => <Typography.Text className="mono" copyable>{value}</Typography.Text> }]} />}
    </Card>
  </div>;
}
