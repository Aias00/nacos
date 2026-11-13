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
import { useState } from 'react';
import { Button, Card, Form, Input, Message, Modal, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { IconPlus, IconRefresh } from '@arco-design/web-react/icon';
import { api } from '../api';
import { useConsole } from '../context';
import { showError } from '../utils';
import type { Namespace } from '../types';

export default function Namespaces() {
  const { namespaces, namespace, setNamespace, session, reloadNamespaces } = useConsole();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Namespace | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  function open(item?: Namespace) {
    form.resetFields();
    form.setFieldsValue(item ? { namespaceId: item.namespace, namespaceName: item.namespaceShowName, namespaceDesc: item.namespaceDesc } : {});
    setEditing(item || 'new');
  }
  async function save() {
    let values: { namespaceId?: string; customNamespaceId?: string; namespaceName: string; namespaceDesc?: string };
    try { values = await form.validate(); } catch { return; }
    setBusy(true);
    try {
      const result = editing === 'new' ? await api.createNamespace({ ...values, namespaceName: values.namespaceName.trim() })
        : await api.updateNamespace({ ...values, namespaceName: values.namespaceName.trim() });
      if (result !== true) throw new Error('命名空间未成功保存');
      Message.success('命名空间已保存'); setEditing(null); await reloadNamespaces();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  function remove(item: Namespace) {
    Modal.confirm({ title: '确认删除命名空间？', content: `${item.namespaceShowName} (${item.namespace})。请确认该空间已不再使用。`,
      okText: '删除', okButtonProps: { status: 'danger' }, onOk: async () => {
        try {
          const services = await api.services({ namespaceId: item.namespace, pageNo: 1, pageSize: 1 });
          if (item.configCount || services.totalCount) throw new Error('请先清空命名空间中的配置和服务');
          if (await api.deleteNamespace(item.namespace) !== true) throw new Error('命名空间未成功删除');
          Message.success('命名空间已删除'); await reloadNamespaces();
        } catch (error) { showError(error); throw error; }
      } });
  }
  return <div className="page-stack">
    <div className="page-heading"><Typography.Title heading={4}>命名空间</Typography.Title><Typography.Text type="secondary">按环境隔离配置与服务</Typography.Text></div>
    <Card bordered={false}><div className="table-toolbar">
      {session.globalAdmin ? <Button type="primary" icon={<IconPlus />} onClick={() => open()}>新建命名空间</Button> : <Typography.Text>可见命名空间</Typography.Text>}
      <Button icon={<IconRefresh />} onClick={reloadNamespaces}>刷新</Button></div>
      <Table rowKey="namespace" data={namespaces} pagination={false} scroll={{ x: 800 }} columns={[
        { title: '命名空间名称', dataIndex: 'namespaceShowName', render: (value, row) => <Space>{value}{namespace === row.namespace && <Tag color="arcoblue">当前空间</Tag>}</Space> },
        { title: 'Namespace ID', dataIndex: 'namespace', render: (value) => <Typography.Text copyable>{value || 'public'}</Typography.Text> },
        { title: '描述', dataIndex: 'namespaceDesc', render: (value) => value || '—' },
        { title: '配置数量', dataIndex: 'configCount' }, { title: '配置配额', dataIndex: 'quota' },
        { title: '操作', width: 230, render: (_, row) => <Space size={0}><Button type="text" disabled={namespace === row.namespace} onClick={() => setNamespace(row.namespace)}>切换</Button>
          {session.globalAdmin && <><Button type="text" onClick={() => open(row)}>编辑</Button>
            <Button type="text" status="danger" disabled={!row.namespace || row.namespace === 'public' || row.type === 0 || row.configCount > 0} onClick={() => remove(row)}>删除</Button></>}</Space> },
      ]} />
    </Card>
    <Modal title={editing === 'new' ? '新建命名空间' : '编辑命名空间'} visible={!!editing} onCancel={() => setEditing(null)} onOk={save} confirmLoading={busy} unmountOnExit>
      <Form form={form} layout="vertical"><Form.Item field={editing === 'new' ? 'customNamespaceId' : 'namespaceId'} label="Namespace ID" extra={editing === 'new' ? '留空时由服务端生成唯一 ID' : 'ID 创建后不可修改'}>
        <Input disabled={editing !== 'new'} placeholder="例如 development" /></Form.Item>
        <Form.Item field="namespaceName" label="命名空间名称" rules={[{ required: true, match: /\S/, message: '请输入名称' }]}><Input placeholder="例如开发环境" /></Form.Item>
        <Form.Item field="namespaceDesc" label="描述"><Input.TextArea placeholder="可选" rows={3} /></Form.Item></Form>
    </Modal>
  </div>;
}
