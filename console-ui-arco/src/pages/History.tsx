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
import { lazy, Suspense, useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Empty, Form, Input, Modal, Space, Spin, Table, Tag, Typography } from '@arco-design/web-react';
import { IconSearch } from '@arco-design/web-react/icon';
import { api } from '../api';
import { useConsole } from '../context';
import { useResource } from '../useResource';
import RequestError from '../RequestError';
import { formatTime, showError } from '../utils';
import type { History as HistoryRecord } from '../types';
const Editor = lazy(() => import('../Editor'));

export default function History() {
  const { namespace, dark } = useConsole();
  const [params] = useSearchParams();
  const [query, setQuery] = useState({ dataId: params.get('dataId') || '', groupName: params.get('groupName') || 'DEFAULT_GROUP' });
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<HistoryRecord | null>(null);
  const [opening, setOpening] = useState(false);
  const load = useCallback(() => query.dataId ? api.history({ ...query, namespaceId: namespace }, page)
    : Promise.resolve({ totalCount: 0, pageItems: [] as HistoryRecord[] }), [namespace, query, page]);
  const resource = useResource(load);
  async function view(id: string) {
    setOpening(true);
    try { setDetail(await api.historyDetail({ ...query, namespaceId: namespace }, String(id))); }
    catch (error) { showError(error); }
    finally { setOpening(false); }
  }
  return <div className="page-stack">
    <div className="page-heading"><Typography.Title heading={4}>历史版本</Typography.Title><Tag>Namespace · {namespace || 'public'}</Tag></div>
    <Card bordered={false}><Form layout="inline" className="filter-form" initialValues={query}
      onSubmit={(values) => { setPage(1); setQuery({ dataId: values.dataId.trim(), groupName: values.groupName.trim() }); }}>
      <Form.Item label="Data ID" field="dataId" rules={[{ required: true, match: /\S/ }]}><Input placeholder="请输入完整 Data ID" style={{ width: 260 }} /></Form.Item>
      <Form.Item label="Group" field="groupName" rules={[{ required: true, match: /\S/ }]}><Input style={{ width: 220 }} /></Form.Item>
      <Button type="primary" htmlType="submit" icon={<IconSearch />}>查询</Button>
    </Form></Card>
    <Card bordered={false}><RequestError error={resource.error} retry={resource.reload} />
      {!query.dataId ? <Empty description="输入 Data ID 和 Group 查询配置历史" /> : <Table rowKey="id" loading={resource.loading || opening}
        data={resource.data?.pageItems || []} scroll={{ x: 850 }} pagination={{ current: page, total: resource.data?.totalCount || 0, showTotal: true }} onChange={(value) => setPage(value.current || 1)}
        columns={[{ title: '版本 ID', dataIndex: 'id' }, { title: 'Data ID', dataIndex: 'dataId' }, { title: 'Group', dataIndex: 'groupName' },
          { title: '操作', dataIndex: 'opType', render: (value) => <Tag color={value === 'D' ? 'red' : 'arcoblue'}>{({ I: '新增', U: '更新', D: '删除' } as Record<string, string>)[String(value).trim()] || value}</Tag> },
          { title: '操作人', dataIndex: 'srcUser' }, { title: '时间', render: (_, row) => formatTime(row.modifiedTime || row.modifyTime || row.createdTime) },
          { title: '详情', render: (_, row) => <Button type="text" onClick={() => view(row.id)}>查看内容</Button> }]} />}
    </Card>
    <Modal title="历史配置内容" visible={!!detail} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} style={{ width: 'min(900px, 96vw)' }} unmountOnExit>
      <Space direction="vertical" style={{ width: '100%' }}><Typography.Text>{query.dataId} / {query.groupName} · 版本 {detail?.id}</Typography.Text>
        <Suspense fallback={<Spin />}><Editor value={detail?.content || ''} type={detail?.type || 'text'} dark={dark} readOnly height={400} /></Suspense></Space>
    </Modal>
  </div>;
}
