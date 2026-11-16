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
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Collapse, Descriptions, Drawer, Form, Input, Message, Modal, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { IconEdit, IconRefresh } from '@arco-design/web-react/icon';
import { clearsCopilotKey, copilotApi, prepareCopilotUpdate } from '../../copilot-api';
import type { CopilotConfig, CopilotChanges } from '../../copilot-api';
import { useConsole } from '../../context';
import { useResource } from '../../useResource';
import RequestError from '../../RequestError';
import { showError } from '../../utils';

export default function Copilot() {
  const { session, setNamespaceLocked } = useConsole();
  const [editing, setEditing] = useState<CopilotConfig | null>(null);
  const load = useCallback((signal: AbortSignal) => copilotApi.get(signal), []);
  const resource = useResource(load);
  useEffect(() => {
    setNamespaceLocked(!!editing);
    return () => setNamespaceLocked(false);
  }, [editing, setNamespaceLocked]);
  const config = !resource.loading && !resource.error ? resource.data : undefined;
  return <div className="page-stack">
    <div className="page-heading"><Typography.Title heading={4}>Copilot 设置</Typography.Title><Tag>平台级配置</Tag></div>
    <Alert type="info" content="此设置作用于整个平台。切换顶部命名空间不会改变 Copilot 配置。当前服务端通过 DashScope 使用 Qwen 模型。" />
    <Card bordered={false} title="模型配置" extra={<Space><Button icon={<IconRefresh />} loading={resource.loading} onClick={resource.reload}>刷新</Button>
      <Button type="primary" icon={<IconEdit />} disabled={!session.globalAdmin || !config} onClick={() => config && setEditing({ ...config })}>编辑配置</Button></Space>}>
      <RequestError error={resource.error} retry={resource.reload} />
      {resource.loading && <Spin />}
      {config && <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {!config.apiKey.trim() && <Alert type="warning" content="尚未配置 API Key。保存 DashScope API Key 后，Copilot 才能访问所配置的模型。" />}
        <Descriptions column={1} data={[
          { label: '服务提供方', value: '阿里云 DashScope' },
          { label: '配置状态', value: <Tag color={config.apiKey.trim() ? 'green' : 'orange'}>{config.apiKey.trim() ? '已配置凭据' : '未配置凭据'}</Tag> },
          { label: 'API Key', value: config.apiKey.trim() ? '••••••••（已配置）' : '未配置' },
          { label: 'Qwen 模型', value: config.model || '未配置' },
          { label: 'AgentScope Studio URL', value: config.studioUrl || '未配置' },
          { label: 'Studio 项目', value: config.studioProject || '未配置' },
        ]} />
        <Typography.Paragraph type="secondary">保存后由服务端刷新配置。配置状态表示已保存凭据，模型可用性及调用结果由实际 Copilot 请求决定。</Typography.Paragraph>
      </Space>}
    </Card>
    {editing && <CopilotEditor original={editing} close={() => setEditing(null)} saved={() => { setEditing(null); resource.reload(); }} />}
  </div>;
}

function CopilotEditor({ original, close, saved }: { original: CopilotConfig; close: () => void; saved: () => void }) {
  const [form] = Form.useForm<CopilotConfig>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function cancel() {
    if (saving) return;
    if (dirty) Modal.confirm({ title: '放弃未保存的 Copilot 配置？', content: '本次修改尚未保存到服务端。', okText: '放弃修改', cancelText: '继续编辑', onOk: close });
    else close();
  }
  async function save() {
    let values: CopilotConfig;
    try { values = await form.validate(); } catch { return; }
    let next: CopilotConfig;
    try {
      const touched = form.getTouchedFields();
      const changes: CopilotChanges = { apiKey: values.apiKey, model: values.model };
      if (touched.includes('studioUrl')) changes.studioUrl = values.studioUrl;
      if (touched.includes('studioProject')) changes.studioProject = values.studioProject;
      next = prepareCopilotUpdate(original, changes);
    } catch (error) { showError(error); return; }
    const persist = async () => {
      setSaving(true);
      try { await copilotApi.save(next); Message.success('Copilot 配置已保存'); saved(); }
      catch (error) { showError(error); throw error; }
      finally { setSaving(false); }
    };
    if (clearsCopilotKey(original, next)) Modal.confirm({ title: '确认清空现有 API Key？',
      content: '清空后，Copilot 无法使用该凭据访问模型。此变更影响整个平台。', okText: '清空并保存', okButtonProps: { status: 'danger' }, onOk: persist });
    else { try { await persist(); } catch { /* Error is displayed by persist; keep editor open. */ } }
  }
  return <Drawer visible title="编辑 Copilot 配置" width="min(760px, 100vw)" maskClosable={false} onCancel={cancel}
    footer={<Space><Button disabled={saving} onClick={cancel}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存配置</Button></Space>}>
    <Form form={form} layout="vertical" initialValues={{ ...original, studioUrl: original.studioUrl || '', studioProject: original.studioProject || '' }} onValuesChange={() => setDirty(true)}>
      <Alert type="info" content="平台级配置，服务提供方为 DashScope。请填写账号可用的 Qwen 模型名称。" />
      <Form.Item field="apiKey" label="DashScope API Key" extra="留空会清空凭据；清空已有凭据时需要确认。"><Input.Password autoComplete="new-password" placeholder="输入 DashScope API Key" /></Form.Item>
      <Form.Item field="model" label="Qwen 模型名称" rules={[{ required: true, match: /\S/, message: '请输入模型名称' }]} extra="例如 qwen-turbo、qwen-plus。模型是否开放取决于 DashScope 账号。"><Input placeholder="qwen-turbo" /></Form.Item>
      <Collapse><Collapse.Item name="studio" header="AgentScope Studio 高级设置（可选）">
        <Typography.Paragraph type="secondary">未修改的高级设置会保留当前服务端值。</Typography.Paragraph>
        <Form.Item field="studioUrl" label="Studio URL" extra="留空表示不配置；非空时必须是 HTTP 或 HTTPS 地址。"><Input placeholder="https://studio.example.com" /></Form.Item>
        <Form.Item field="studioProject" label="Studio 项目"><Input placeholder="项目名称" /></Form.Item>
      </Collapse.Item></Collapse>
    </Form>
  </Drawer>;
}
