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
import { Alert, Button, Card, Collapse, Descriptions, Drawer, Empty, Form, Input, Message, Modal, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography } from '@arco-design/web-react';
import { IconPlus, IconRefresh, IconSearch } from '@arco-design/web-react/icon';
import { registries, registryName, initialDraft, draftPayload, customLabels, parseObject, mcpClientConfigs, registryVersionActions, mcpManagementResource } from '../../ai-registries';
import type { DraftFields, RegistryKind, RegistryOverview, RegistryResource, RegistryTarget, RegistryVersion, CallInterface } from '../../ai-registries';
import { AiResourceTag, AiScopeTag, AiVersionTag } from '../../components/ai/Status';
import { pipelineState } from '../../components/ai/pipeline';
import { useConsole } from '../../context';
import { useResource } from '../../useResource';
import RequestError from '../../RequestError';
import { formatTime, showError } from '../../utils';

const Editor = lazy(() => import('../../Editor'));
const pageSize = 10;
const json = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

function JsonView({ value, height = 300 }: { value: unknown; height?: number }) {
  const { dark } = useConsole();
  return <Suspense fallback={<Spin />}><Editor value={json(value)} type="json" dark={dark} readOnly height={height} /></Suspense>;
}

interface EditState {
  target: RegistryTarget; fields: DraftFields; update: boolean; existing: boolean;
}

export default function Registries({ kind }: { kind: RegistryKind }) {
  const { namespace } = useConsole();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<RegistryTarget>();
  const [editing, setEditing] = useState<EditState>();
  const [detailRevision, setDetailRevision] = useState(0);
  const title = kind === 'mcp' ? 'MCP 服务' : 'Agent 管理';
  const list = useResource(useCallback((signal: AbortSignal) => registries.list(kind, {
    namespaceId: namespace, [kind === 'mcp' ? 'mcpName' : 'agentName']: search,
    ...(kind === 'mcp' ? { search: 'blur' } : {}), pageNo: page, pageSize,
  }, signal), [kind, namespace, search, page]));
  function openDraft(target: RegistryTarget, source?: RegistryVersion, update = false) {
    const fields = initialDraft(target.name, source);
    if (source && !update) fields.version = '';
    setEditing({ target, fields, update, existing: !!target.name });
  }
  return <div className="page-stack">
    <div className="page-heading"><Typography.Title heading={4}>{title}</Typography.Title>
      <Typography.Text type="secondary">{kind === 'mcp' ? '管理工具、资源、连接地址与版本发布' : '管理调用协议、版本与运行时地址'}</Typography.Text></div>
    <Card bordered={false}><div className="table-toolbar"><Space wrap>
      <Input.Search aria-label={`搜索${title}`} placeholder="按名称搜索" value={query} onChange={setQuery}
        onSearch={() => { setSearch(query.trim()); setPage(1); }} searchButton={<IconSearch />} style={{ width: 280 }} />
      <Button type="primary" icon={<IconPlus />} onClick={() => openDraft({ kind, namespaceId: namespace, name: '' })}>新建{kind === 'mcp' ? ' MCP' : ' Agent'}</Button>
    </Space><Button icon={<IconRefresh />} onClick={list.reload}>刷新</Button></div>
      <RequestError error={list.error} retry={list.reload} />
      <Table<RegistryResource> rowKey={(row) => registryName(row)} loading={list.loading} data={list.loading ? [] : list.data?.pageItems || []}
        scroll={{ x: 850 }} pagination={{ current: page, pageSize, total: list.data?.totalCount || 0, onChange: setPage, showTotal: true }} columns={[
          { title: '名称', render: (_, row) => <Button type="text" onClick={() => setSelected({ kind, namespaceId: namespace, name: registryName(row) })}>{row.displayName || registryName(row)}</Button> },
          { title: kind === 'mcp' ? '协议' : 'Agent ID', render: (_, row) => kind === 'mcp' ? <Tag>{row.frontProtocol || row.protocol}</Tag> : registryName(row) },
          { title: '描述', dataIndex: 'description', ellipsis: true, render: (value) => value || '—' },
          { title: '资源状态', render: (_, row) => <AiResourceTag enabled={kind === 'mcp' ? row.enabled : row.status} /> },
          ...(kind === 'agent' ? [{ title: '可见性', render: (_: unknown, row: RegistryResource) => <AiScopeTag scope={row.scope} /> }] : []),
          { title: '操作', width: 140, render: (_, row) => <Button type="text" onClick={() => setSelected({ kind, namespaceId: namespace, name: registryName(row) })}>管理与版本</Button> },
        ]} />
    </Card>
    {selected && <RegistryDetail key={`${selected.kind}/${selected.namespaceId}/${selected.name}/${detailRevision}`} target={selected}
      onClose={() => setSelected(undefined)} onChange={list.reload} onDraft={openDraft} />}
    {editing && <DraftEditor key={`${editing.target.name}/${editing.fields.version}/${editing.update}`} editing={editing}
      onClose={() => setEditing(undefined)} onSave={(target) => { setEditing(undefined); list.reload(); setDetailRevision((value) => value + 1); setSelected(target); }} />}
  </div>;
}

function RegistryDetail({ target, onClose, onChange, onDraft }: {
  target: RegistryTarget; onClose: () => void; onChange: () => void;
  onDraft: (target: RegistryTarget, source?: RegistryVersion, update?: boolean) => void;
}) {
  const { session } = useConsole();
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [governance, setGovernance] = useState<'labels' | 'metadata'>();
  const versions = useResource(useCallback((signal: AbortSignal) => registries.versions(target, page, signal), [target, page]));
  const overview = useResource(useCallback((signal: AbortSignal) => target.kind === 'agent'
    ? registries.overview(target, signal) : Promise.resolve(undefined), [target]));
  const versionName = chosen || versions.data?.pageItems.find((row) => row.status === 'draft')?.version || versions.data?.pageItems[0]?.version || '';
  const version = useResource(useCallback((signal: AbortSignal) => versionName ? registries.version(target, versionName, signal) : Promise.resolve(undefined), [target, versionName]));
  // useResource retains the previous response while reloading; never use that response for a new target.
  const current = !version.loading ? version.data : undefined;
  const resource = target.kind === 'agent' ? (overview.data as RegistryOverview | undefined)?.agent
    : current ? mcpManagementResource(target.name, current) : undefined;
  const writable = !overview.error && !versions.error && !version.error && !versions.loading && !version.loading
    && resource?.writable !== false && current?.writable !== false
    && (!!resource || (target.kind === 'mcp' && versions.data?.totalCount === 0));
  const state = current ? pipelineState(current.publishPipelineInfo) : null;
  const actions = registryVersionActions(current?.status || '', state, session.globalAdmin);
  const metadata = resource;
  function refresh() { versions.reload(); version.reload(); overview.reload(); onChange(); }
  const reloadVersion = version.reload;
  const reloadVersions = versions.reload;
  const reviewStatus = version.data?.status;
  useEffect(() => {
    if (reviewStatus !== 'reviewing') return;
    const timer = window.setInterval(() => { reloadVersion(); reloadVersions(); }, 6000);
    return () => window.clearInterval(timer);
  }, [reviewStatus, reloadVersion, reloadVersions]);

  async function perform(action: () => Promise<unknown>, success = '操作成功') {
    setBusy(true);
    try { await action(); Message.success(success); refresh(); }
    catch (error) { showError(error); throw error; }
    finally { setBusy(false); }
  }
  function confirmAction(action: 'submit' | 'publish' | 'force-publish' | 'redraft' | 'online' | 'offline') {
    if (!current) return;
    const exact = current.version;
    const titles = { submit: '提交此版本审核？', publish: '发布此版本？', 'force-publish': '绕过审核并强制发布？', redraft: '将此版本退回草稿？', online: '上线此版本？', offline: '下线此版本？' };
    Modal.confirm({ title: titles[action], content: <div><p>{target.namespaceId || 'public'} / {target.name} / {exact}</p>
      <p>{action === 'submit' ? '提交后内容冻结；未配置适用审核流水线时，服务端会直接发布。' : action === 'force-publish' ? '此操作绕过当前拒绝结果并记录审计。请确认已审查风险。' : '版本状态与 latest 标签由服务端维护。'}</p></div>,
      okText: '确认', okButtonProps: { status: action === 'force-publish' || action === 'offline' ? 'danger' : undefined },
      onOk: () => { setChosen(exact); return perform(() => registries.action(target, exact, action)); } });
  }
  function removeDraft() {
    if (!current) return;
    const exact = current.version;
    Modal.confirm({ title: '删除此草稿？', content: `${target.name} / ${exact}，草稿内容将被移除。`, okText: '删除', okButtonProps: { status: 'danger' },
      onOk: async () => { await perform(() => registries.deleteDraft(target, exact)); setChosen(''); } });
  }
  function removeResource() {
    Modal.confirm({ title: `删除${target.kind === 'mcp' ? ' MCP 服务' : ' Agent'}及全部版本？`,
      content: <div><p>{target.namespaceId || 'public'} / {target.name}</p><p>删除后停止该资源的发现，请先确认调用方已完成迁移。</p></div>,
      okText: '删除资源', okButtonProps: { status: 'danger' }, onOk: async () => {
        await perform(() => registries.remove(target), '资源已删除'); onClose();
      } });
  }
  const enabled = metadata?.status ? metadata.status === 'enable' : resource?.enabled;
  const labels = metadata?.labels || metadata?.versionInfo?.labels || {};
  return <Drawer visible width="min(1180px, 96vw)" title={`${target.kind === 'mcp' ? 'MCP' : 'Agent'} · ${target.name}`}
    onCancel={onClose} footer={null} unmountOnExit><div className="page-stack">
    <Alert type="info" content={`命名空间：${target.namespaceId || 'public'}。版本操作始终使用所选精确版本。`} />
    <RequestError error={overview.error || versions.error} retry={refresh} />
    <Space wrap><Button icon={<IconRefresh />} loading={busy} onClick={refresh}>刷新</Button>
      {writable && <>{metadata && <Button onClick={() => setGovernance('labels')}>版本标签</Button>}
        {target.kind === 'agent' && <Button onClick={() => setGovernance('metadata')}>编辑资源信息</Button>}
        <Button status="danger" onClick={removeResource}>删除资源</Button></>}
    </Space>
    {metadata && <Card title="资源信息" size="small"><Descriptions column={2} data={[
      { label: '资源名', value: <Typography.Text copyable>{target.name}</Typography.Text> },
      { label: '所有者', value: metadata.owner || '—' },
      { label: '状态', value: <Space><AiResourceTag enabled={enabled} /><Switch checked={enabled === true} disabled={!writable || busy}
        onChange={(value) => Modal.confirm({ title: value ? '启用此资源？' : '禁用此资源？', content: '资源启停不会删除版本内容。',
          onOk: () => perform(() => registries.status(target, value, metadata)) })} /></Space> },
      { label: '可见性', value: <Space><AiScopeTag scope={metadata.scope} /><Select aria-label="资源可见性" value={metadata.scope}
        placeholder="可见性" disabled={!writable || busy} style={{ width: 120 }} options={[{ label: '公开', value: 'PUBLIC' }, { label: '私有', value: 'PRIVATE' }]}
        onChange={(scope: string) => Modal.confirm({ title: scope === 'PUBLIC' ? '公开此资源？' : '设为私有资源？', content: '可见性策略仍由服务端校验。', onOk: () => perform(() => registries.scope(target, scope)) })} /></Space> },
      { label: '标签', value: <Space wrap>{Object.entries(labels).length ? Object.entries(labels).map(([key, value]) => <Tag key={key}>{key} → {value}</Tag>) : '—'}</Space> },
      { label: '描述', value: metadata.description || '—' },
    ]} /></Card>}
    <Card title="版本" size="small" extra={writable && versions.data?.totalCount === 0 ? <Button onClick={() => onDraft(target)}>新建版本</Button> : undefined}>
      <Table<RegistryVersion> rowKey="version" size="small" loading={versions.loading} data={versions.data?.pageItems || []}
        pagination={{ current: page, pageSize, total: versions.data?.totalCount || 0, onChange: (next) => { setPage(next); setChosen(''); }, showTotal: true }} columns={[
          { title: '版本', dataIndex: 'version', render: (value) => <Button type="text" onClick={() => setChosen(value)}>{value}{value === versionName ? ' · 当前' : ''}</Button> },
          { title: '状态', render: (_, row) => <AiVersionTag status={row.status} pipeline={row.publishPipelineInfo} /> },
          { title: '作者', dataIndex: 'author', render: (value) => value || '—' },
          { title: '更新时间', dataIndex: 'updateTime', render: (value) => formatTime(String(value || '')) },
        ]} />
    </Card>
    {versionName && <Card title={`版本 ${versionName}`} size="small"><RequestError error={version.error} retry={version.reload} />
      {version.loading ? <Spin /> : current && <div className="page-stack">
        <Space wrap><AiVersionTag status={current.status} pipeline={current.publishPipelineInfo} />
          {writable && <>
            {current.status === 'draft' && <><Button onClick={() => onDraft(target, current, true)}>编辑草稿</Button><Button status="danger" onClick={removeDraft}>删除草稿</Button></>}
            {actions.includes('submit') && <Button type="primary" loading={busy} onClick={() => confirmAction('submit')}>{current.status === 'draft' ? '提交审核' : '重新提交审核'}</Button>}
            {actions.includes('publish') && <Button type="primary" loading={busy} onClick={() => confirmAction('publish')}>发布</Button>}
            {actions.includes('force-publish') && <Button status="danger" loading={busy} onClick={() => confirmAction('force-publish')}>管理员强制发布</Button>}
            {actions.includes('redraft') && <Button loading={busy} onClick={() => confirmAction('redraft')}>退回编辑</Button>}
            {current.status === 'online' && <><Button loading={busy} onClick={() => confirmAction('offline')}>下线</Button><Button onClick={() => onDraft(target, current)}>基于此版本创建草稿</Button></>}
            {current.status === 'offline' && <><Button type="primary" loading={busy} onClick={() => confirmAction('online')}>上线</Button>
              {target.kind === 'agent' && <Button onClick={() => onDraft(target, current)}>基于此版本创建草稿</Button>}</>}
          </>}
        </Space>
        {current.status === 'reviewing' && <Alert type="info" content="审核进行中，内容已冻结；每 6 秒刷新审核状态。" />}
        {current.publishPipelineInfo != null && <Collapse><Collapse.Item name="pipeline" header="审核流水线结果"><JsonView value={parsePipeline(current.publishPipelineInfo)} height={240} /></Collapse.Item></Collapse>}
        {target.kind === 'mcp' ? <McpContent target={target} version={current} /> : <AgentContent target={target} version={current} />}
      </div>}
    </Card>}
    {governance && metadata && <GovernanceEditor mode={governance} target={target} resource={metadata} labels={labels}
      onClose={() => setGovernance(undefined)} onSave={() => { setGovernance(undefined); refresh(); }} />}
  </div></Drawer>;
}

function parsePipeline(value: unknown) {
  if (typeof value === 'string') { try { return JSON.parse(value) as unknown; } catch { return value; } }
  return value;
}

function McpContent({ target, version }: { target: RegistryTarget; version: RegistryVersion }) {
  const serving = useResource(useCallback((signal: AbortSignal) => version.status === 'online'
    ? registries.serving(target, version.version, signal) : Promise.resolve(undefined), [target, version.status, version.version]));
  const tools = Array.isArray(version.toolSpecification?.tools) ? version.toolSpecification.tools as { name: string; description?: string; inputSchema?: unknown; outputSchema?: unknown }[] : [];
  const endpoints = serving.data?.frontendEndpoints?.length ? serving.data.frontendEndpoints : serving.data?.backendEndpoints || [];
  const specification = version.serverSpecification || {};
  const clients = mcpClientConfigs(target.name, { ...specification, ...serving.data } as RegistryResource);
  return <Tabs defaultActiveTab="tools">
    <Tabs.TabPane key="tools" title={`工具 (${tools.length})`}><Table rowKey="name" pagination={false} data={tools}
      columns={[{ title: '名称', dataIndex: 'name' }, { title: '描述', dataIndex: 'description' }]}
      expandedRowRender={(row) => <JsonView value={row} height={230} />} /></Tabs.TabPane>
    <Tabs.TabPane key="definition" title="服务定义"><JsonView value={specification} /></Tabs.TabPane>
    <Tabs.TabPane key="resources" title="资源与安全"><JsonView value={{ resources: version.resourceSpecification || {}, tools: version.toolSpecification || {} }} /></Tabs.TabPane>
    <Tabs.TabPane key="endpoints" title="连接与客户端配置"><div className="page-stack">
      <RequestError error={serving.error} retry={serving.reload} />
      {version.status !== 'online' && <Alert type="info" content="该版本尚未上线，运行时连接地址以在线版本为准。" />}
      {version.status === 'online' && <><Typography.Text type="secondary">优先使用前端访问地址，完整 Endpoint 信息保留服务端返回值。</Typography.Text><JsonView value={endpoints} height={200} /></>}
      {clients.map((client) => <div key={client.label}><Typography.Text>客户端配置 · {client.label}</Typography.Text><JsonView value={client.config} height={240} /></div>)}
    </div></Tabs.TabPane>
  </Tabs>;
}

function AgentContent({ target, version }: { target: RegistryTarget; version: RegistryVersion }) {
  const interfaces = version.callInterfaces || [];
  return <Tabs defaultActiveTab={interfaces[0]?.protocol} destroyOnHide>{interfaces.length ? interfaces.map((item) =>
    <Tabs.TabPane key={item.protocol} title={item.protocol}><AgentProtocol key={`${version.version}/${item.protocol}`} target={target} version={version.version} descriptor={item} /></Tabs.TabPane>)
    : <Tabs.TabPane key="empty" title="调用接口"><Empty description="此版本未返回调用接口" /></Tabs.TabPane>}</Tabs>;
}

function AgentProtocol({ target, version, descriptor }: { target: RegistryTarget; version: string; descriptor: CallInterface }) {
  const runtime = useResource(useCallback((signal: AbortSignal) => registries.runtime(target, version, descriptor.protocol, signal), [target, version, descriptor.protocol]));
  const endpoints = runtime.data?.runtimeEndpointSnapshot.callInterface.endpointSets?.flatMap((set) => set.endpoints) || [];
  return <div className="page-stack">
    {!descriptor.endpointSourceOrder?.includes('RUNTIME') && <Alert type="info" content="此版本未将 RUNTIME 纳入地址来源；下方注册地址不会进入该版本的 Discover 结果。" />}
    <Collapse defaultActiveKey={['descriptor']}><Collapse.Item name="descriptor" header="协议定义与声明地址"><JsonView value={descriptor} /></Collapse.Item></Collapse>
    <Space><Typography.Title heading={6}>运行时注册地址</Typography.Title><Button size="small" icon={<IconRefresh />} onClick={runtime.reload}>刷新</Button></Space>
    <RequestError error={runtime.error} retry={runtime.reload} />
    <Table rowKey={(row) => `${row.uri}/${row.transport}`} loading={runtime.loading} data={endpoints} pagination={false}
      columns={[{ title: '地址', dataIndex: 'uri' }, { title: '传输', dataIndex: 'transport' },
        { title: '健康', render: (_, row) => <Tag color={row.healthy === false ? 'red' : 'green'}>{row.healthy === false ? '不健康' : '健康'}</Tag> },
        { title: '启用', render: (_, row) => <AiResourceTag enabled={row.enabled} /> }, { title: '权重', dataIndex: 'weight' }]}
      expandedRowRender={(row) => <JsonView value={row} height={180} />} />
    {runtime.data?.namingServiceRef && <Descriptions column={1} data={[
      { label: '关联 Naming 服务', value: <Typography.Text copyable>{json(runtime.data.namingServiceRef)}</Typography.Text> },
      { label: '地址管理', value: '在服务管理中按以上 Namespace、Group 和服务名查看实例并控制启停。' },
    ]} />}
  </div>;
}

function DraftEditor({ editing, onClose, onSave }: { editing: EditState; onClose: () => void; onSave: (target: RegistryTarget) => void }) {
  const { dark, setNamespaceLocked } = useConsole();
  const [fields, setFields] = useState(editing.fields);
  const [busy, setBusy] = useState(false);
  const dirty = json(fields) !== json(editing.fields);
  useEffect(() => { setNamespaceLocked(true); return () => setNamespaceLocked(false); }, [setNamespaceLocked]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function close() {
    if (busy) return;
    if (dirty) Modal.confirm({ title: '放弃未保存的草稿修改？', content: '关闭后本次输入不会保存。', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose });
    else onClose();
  }
  function change(key: keyof DraftFields, value: string) { setFields((previous) => ({ ...previous, [key]: value })); }
  async function save() {
    setBusy(true);
    try {
      const target = { ...editing.target, name: fields.name.trim() };
      const payload = draftPayload(target.kind, fields, editing.update, editing.existing);
      await registries.draft(target, fields.version.trim(), payload, editing.update);
      Message.success('草稿已保存，提交审核后才能发布'); onSave(target);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  function code(field: keyof DraftFields, height = 300) {
    return <Suspense fallback={<Spin />}><Editor value={fields[field]} onChange={(value) => change(field, value)} type="json" dark={dark} height={height} /></Suspense>;
  }
  return <Modal visible title={editing.update ? '编辑草稿' : '新建草稿'} style={{ width: 'min(1000px, 94vw)' }} onCancel={close}
    maskClosable={false} confirmLoading={busy} okText="保存草稿" onOk={save} unmountOnExit>
    <div className="page-stack"><Alert type="info" content={`命名空间：${editing.target.namespaceId || 'public'}。草稿保存不调用远程模型。`} />
    <Form layout="vertical"><Form.Item label="资源名称" required><Input value={fields.name} disabled={editing.existing} onChange={(value) => change('name', value)} placeholder="唯一资源名称" /></Form.Item>
      <Form.Item label="精确版本" required><Input value={fields.version} disabled={editing.update} onChange={(value) => change('version', value)} placeholder="例如 1.0.0" /></Form.Item>
      {(editing.target.kind === 'mcp' || !editing.existing) && <>
        {editing.target.kind === 'agent' && <Form.Item label="显示名称"><Input value={fields.displayName} onChange={(value) => change('displayName', value)} /></Form.Item>}
        <Form.Item label="描述"><Input.TextArea value={fields.description} onChange={(value) => change('description', value)} /></Form.Item>
      </>}
      {editing.target.kind === 'mcp' ? <>
        <Form.Item label="接入协议"><Select value={fields.protocol} onChange={(value) => change('protocol', value)} options={['mcp-streamable', 'mcp-sse', 'stdio', 'http', 'dubbo', 'off']} /></Form.Item>
        {fields.protocol !== 'stdio' && <Form.Item label="Endpoint URL" extra="填写后生成 DIRECT 地址；留空时使用下方高级 Endpoint 设置。已有服务自动保留完整的 Naming 引用；无法恢复原引用时须明确填写地址。">
          <Input value={fields.endpoint} placeholder="https://example.com/mcp" onChange={(value) => change('endpoint', value)} /></Form.Item>}
        <Collapse defaultActiveKey={['tools']}><Collapse.Item name="tools" header="工具定义（tools、inputSchema、annotations 等）">{code('tools')}</Collapse.Item>
          <Collapse.Item name="server" header="服务高级设置（stdio 启动命令、包、协议和远程引用）"><Alert type="info" content={'stdio 示例：{"localServerConfig":{"command":"node","args":["/path/server.js"]}}。高级设置中的自定义字段会保留。'} />{code('server')}</Collapse.Item>
          <Collapse.Item name="resources" header="资源定义">{code('resources', 220)}</Collapse.Item>
          <Collapse.Item name="endpoint" header="高级 Endpoint 设置（可选）"><Input.TextArea value={fields.endpointSpecification}
            onChange={(value) => change('endpointSpecification', value)} placeholder={'{"type":"REF","data":{"namespaceId":"public","groupName":"DEFAULT_GROUP","serviceName":"mcp-backend"}}'} rows={5} /></Collapse.Item>
        </Collapse>
      </> : <>
        <Form.Item label="版本变更说明"><Input.TextArea value={fields.changeDescription} onChange={(value) => change('changeDescription', value)} /></Form.Item>
        <Form.Item label="调用接口 CallInterfaces" required extra="每项填写 protocol、nativeDescriptor 与 endpointSourceOrder；声明地址使用 DECLARED，动态注册使用 RUNTIME。">{code('callInterfaces', 400)}</Form.Item>
      </>}
    </Form></div>
  </Modal>;
}

function GovernanceEditor({ mode, target, resource, labels, onClose, onSave }: {
  mode: 'labels' | 'metadata'; target: RegistryTarget; resource: RegistryResource;
  labels: Record<string, string>; onClose: () => void; onSave: () => void;
}) {
  const { dark, setNamespaceLocked } = useConsole();
  const initial = mode === 'labels' ? json(Object.fromEntries(Object.entries(labels).filter(([key]) => key !== 'latest')))
    : json({ displayName: resource.displayName || '', description: resource.description || '', iconUrl: resource.iconUrl || '',
      status: resource.status || 'enable', provider: resource.provider, tags: resource.tags || [], extensions: resource.extensions || {} });
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNamespaceLocked(true); return () => setNamespaceLocked(false); }, [setNamespaceLocked]);
  function close() {
    if (busy) return;
    if (text !== initial) Modal.confirm({ title: '放弃未保存的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose });
    else onClose();
  }
  async function save() {
    setBusy(true);
    try {
      if (mode === 'labels') await registries.labels(target, customLabels(text));
      else {
        const values = parseObject(text, '资源信息');
        if (!['enable', 'disable'].includes(String(values.status))) throw new Error('status 必须为 enable 或 disable');
        await registries.metadata(target, values as RegistryResource);
      }
      Message.success('资源信息已保存'); onSave();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  return <Modal visible title={mode === 'labels' ? '版本标签' : '资源展示信息'} style={{ width: 'min(800px, 94vw)' }} onCancel={close}
    maskClosable={false} onOk={save} okText="保存" confirmLoading={busy}>
    <div className="page-stack"><Alert type="info" content={mode === 'labels' ? '格式为 {"stable":"1.0.0"}；latest 标签由服务端维护。' : '修改展示字段、业务标签和资源启停状态；身份、所有者和版本内容不可修改。'} />
      <Suspense fallback={<Spin />}><Editor value={text} onChange={setText} type="json" dark={dark} height={380} /></Suspense></div>
  </Modal>;
}
