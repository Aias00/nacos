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
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Drawer, Form, Grid, Input, Message, Modal, Select, Space, Spin, Table, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { IconPlus, IconRefresh, IconSearch } from '@arco-design/web-react/icon';
import { api } from '../api';
import { useConsole } from '../context';
import { useResource } from '../useResource';
import RequestError from '../RequestError';
import { showError } from '../utils';
import type { Config, ConfigTarget } from '../types';

const Editor = lazy(() => import('../Editor'));
const formats = ['yaml', 'properties', 'json', 'xml', 'text', 'html', 'toml'];

export default function Configs() {
  const { namespace, dark, reloadNamespaces, setNamespaceLocked } = useConsole();
  const navigate = useNavigate();
  const [filter] = Form.useForm();
  const [form] = Form.useForm();
  const [query, setQuery] = useState({ dataId: '', groupName: '' });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const { current: pageNo, pageSize } = pagination;
  const [editing, setEditing] = useState<{ target: ConfigTarget; value: Config; fresh: boolean } | null>(null);
  const [content, setContent] = useState('');
  const [format, setFormat] = useState('yaml');
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const load = useCallback((signal: AbortSignal) => api.configs({ ...query, namespaceId: namespace,
    pageNo, pageSize, search: 'blur' }, signal), [namespace, query, pageNo, pageSize]);
  const resource = useResource(load);
  useEffect(() => {
    setNamespaceLocked(!!editing);
    return () => setNamespaceLocked(false);
  }, [editing, setNamespaceLocked]);

  async function open(row?: Config) {
    setOpening(true);
    try {
      const target = { namespaceId: namespace, dataId: row?.dataId || '', groupName: row?.groupName || 'DEFAULT_GROUP' };
      const value: Config = row ? await api.config(target) : { ...target, content: '', type: 'yaml', appName: '', desc: '' };
      form.setFieldsValue(value);
      setContent(value.content);
      setFormat(value.type || 'text');
      setEditing({ target, value, fresh: !row });
    } catch (error) { showError(error); }
    finally { setOpening(false); }
  }
  function close() {
    const dirty = editing && (content !== editing.value.content || format !== editing.value.type || form.getTouchedFields().length > 0);
    if (dirty) Modal.confirm({ title: '放弃未发布的修改？', content: '关闭后，本次编辑内容将不会保存。',
      okText: '放弃修改', cancelText: '继续编辑', onOk: () => setEditing(null) });
    else setEditing(null);
  }
  async function publish() {
    if (!editing) return;
    let values: Config;
    try { values = await form.validate(); } catch { return; }
    if (!content.trim()) { Message.warning('请输入配置内容'); return; }
    const target = { ...editing.target, dataId: values.dataId.trim(), groupName: values.groupName.trim() };
    Modal.confirm({ title: editing.fresh ? '确认发布新配置？' : '确认发布配置修改？',
      content: <div><p>命名空间：{target.namespaceId || 'public'}</p><p>Data ID：{target.dataId}</p><p>Group：{target.groupName}</p></div>,
      okText: '确认发布', onOk: async () => {
        setSaving(true);
        try {
          if (await api.publish(target, { ...editing.value, ...values, content, type: format }) !== true) throw new Error('配置未成功发布');
          Message.success('配置发布成功'); setEditing(null); resource.reload(); await reloadNamespaces();
        } catch (error) { showError(error); throw error; }
        finally { setSaving(false); }
      } });
  }
  function remove(row: Config) {
    Modal.confirm({ title: '确认删除配置？', content: `${row.dataId} / ${row.groupName}，删除后可在历史版本中查看记录。`,
      okButtonProps: { status: 'danger' }, okText: '删除', onOk: async () => {
        try {
          if (await api.deleteConfig({ namespaceId: namespace, dataId: row.dataId, groupName: row.groupName }) !== true) throw new Error('配置未成功删除');
          Message.success('配置已删除'); resource.reload(); await reloadNamespaces();
        } catch (error) { showError(error); throw error; }
      } });
  }
  return <div className="page-stack">
    <div className="page-heading" style={{ justifyContent: 'flex-end' }}><Tag>Namespace · {namespace || 'public'}</Tag></div>
    <Card bordered={false}><Form id="config-filter" form={filter} layout="inline" className="filter-form" onSubmit={(values) => { setPagination({ ...pagination, current: 1 }); setQuery({ dataId: values.dataId || '', groupName: values.groupName || '' }); }}>
      <Form.Item label="Data ID" field="dataId"><Input allowClear placeholder="搜索 Data ID" style={{ width: 250 }} /></Form.Item>
      <Form.Item label="Group" field="groupName"><Input allowClear placeholder="搜索 Group" style={{ width: 220 }} /></Form.Item>
      <Space><Button type="primary" htmlType="submit" icon={<IconSearch />}>查询</Button><Button onClick={() => { filter.resetFields(); setQuery({ dataId: '', groupName: '' }); setPagination({ ...pagination, current: 1 }); }}>重置</Button></Space>
    </Form></Card>
    <Card bordered={false}>
      <div className="table-toolbar"><Space><Button type="primary" icon={<IconPlus />} loading={opening} onClick={() => open()}>新建配置</Button>
        <Typography.Text type="secondary">共 {resource.data?.totalCount ?? '—'} 项配置</Typography.Text></Space>
        <Button icon={<IconRefresh />} loading={resource.loading} onClick={resource.reload}>刷新</Button></div>
      <RequestError error={resource.error} retry={resource.reload} />
      <Table tableLayoutFixed rowKey={(row) => row.groupName + '/' + row.dataId} loading={resource.loading || opening} data={resource.data?.pageItems || []}
        scroll={{ x: 850 }} pagination={{ ...pagination, total: resource.data?.totalCount || 0, showTotal: true, sizeCanChange: true }}
        onChange={(page) => setPagination({ current: page.current || 1, pageSize: page.pageSize || 10 })}
        columns={[{ title: 'Data ID', dataIndex: 'dataId', width: 270, render: (value, row) => <Tooltip content={<span aria-hidden="true">{value}</span>} trigger={['hover', 'focus']}><Button className="config-data-id" type="text" onClick={() => open(row)}>{value}</Button></Tooltip> },
          { title: 'Group', dataIndex: 'groupName', width: 180, ellipsis: true }, { title: '配置格式', dataIndex: 'type', width: 100, render: (value) => <Tag color="arcoblue">{String(value || 'text').toUpperCase()}</Tag> },
          { title: '归属应用', dataIndex: 'appName', ellipsis: true, render: (value) => value || '—' },
          { title: '操作', width: 190, render: (_, row) => <Space size={0}><Button type="text" size="small" onClick={() => open(row)}>编辑</Button>
            <Button type="text" size="small" onClick={() => navigate(`/history?${new URLSearchParams({ dataId: row.dataId, groupName: row.groupName })}`)}>历史</Button>
            <Button type="text" size="small" status="danger" onClick={() => remove(row)}>删除</Button></Space> }]} />
    </Card>
    <Drawer title={editing?.fresh ? '新建配置' : '编辑配置'} visible={!!editing} width="min(900px, 100vw)" unmountOnExit
      onCancel={close} maskClosable={false} footer={<Space><Button onClick={close}>取消</Button><Button type="primary" loading={saving} onClick={publish}>发布配置</Button></Space>}>
      <Form id="config-editor" form={form} layout="vertical">
        <Grid.Row gutter={16}><Grid.Col span={12}><Form.Item field="dataId" label="Data ID" rules={[{ required: true, match: /\S/, message: '请输入 Data ID' }]}>
          <Input disabled={!editing?.fresh} placeholder="例如 application.yaml" /></Form.Item></Grid.Col>
        <Grid.Col span={12}><Form.Item field="groupName" label="Group" rules={[{ required: true, match: /\S/, message: '请输入 Group' }]}><Input disabled={!editing?.fresh} /></Form.Item></Grid.Col></Grid.Row>
        <Grid.Row gutter={16}><Grid.Col span={12}><Form.Item label="配置格式"><Select value={format} onChange={setFormat} options={formats.map((value) => ({ value, label: value.toUpperCase() }))} /></Form.Item></Grid.Col>
          <Grid.Col span={12}><Form.Item field="appName" label="归属应用"><Input allowClear placeholder="可选" /></Form.Item></Grid.Col></Grid.Row>
        <Form.Item field="desc" label="描述"><Input allowClear placeholder="配置用途说明" /></Form.Item>
        <Form.Item label="配置内容" required><Suspense fallback={<Spin />}><Editor value={content} onChange={setContent} type={format} dark={dark} /></Suspense></Form.Item>
      </Form>
    </Drawer>
  </div>;
}
