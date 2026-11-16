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
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Form, Input, Message, Modal, Select, Space, Spin, Table, Tabs, Tag, Typography } from '@arco-design/web-react';
import { IconPlus, IconRefresh, IconSearch, IconUpload } from '@arco-design/web-react/icon';
import { useConsole } from '../../context';
import { useResource } from '../../useResource';
import RequestError from '../../RequestError';
import { showError } from '../../utils';
import { AiResourceTag, AiScopeTag, AiVersionTag } from '../../components/ai/Status';
import { pipelineState } from '../../components/ai/pipeline';
import { canForcePublishDocument, canSubmitDocument, customLabels, documentKinds, documentName, documentVersions, documentsApi, parseResources, parseVariables } from '../../ai-documents';
import type { DocumentCard, DocumentKind, DocumentSummary, DocumentTarget, DocumentVersion, UploadCheck } from '../../ai-documents';
import type { Params } from '../../types';

const Editor = lazy(() => import('../../Editor'));
const actionNames: Record<string, string> = { submit: '提交审核', publish: '发布', 'force-publish': '强制发布', redraft: '退回草稿', online: '上线', offline: '下线' };

export default function Documents({ kind }: { kind: DocumentKind }) {
  return <DocumentList key={kind} kind={kind} />;
}
function DocumentList({ kind }: { kind: DocumentKind }) {
  const { namespace, session, setNamespaceLocked } = useConsole();
  const [filter] = Form.useForm();
  const [query, setQuery] = useState({ name: '', owner: '', scope: '' });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [selected, setSelected] = useState<DocumentTarget | null>(null);
  const [creating, setCreating] = useState<DocumentTarget | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNamespace, setUploadNamespace] = useState('');
  const [file, setFile] = useState<File>();
  const [checks, setChecks] = useState<UploadCheck[]>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const meta = documentKinds[kind];
  const { current: pageNo, pageSize } = pagination;
  const load = useCallback((signal: AbortSignal) => documentsApi.list(kind, { namespaceId: namespace,
    [meta.nameKey]: query.name, search: 'blur', ...(kind !== 'prompt' ? { owner: query.owner || undefined, scope: query.scope || undefined } : {}),
    pageNo, pageSize }, signal), [kind, meta.nameKey, namespace, query, pageNo, pageSize]);
  const resource = useResource(load);
  useEffect(() => {
    setNamespaceLocked(!!selected || !!creating || uploading);
    return () => setNamespaceLocked(false);
  }, [selected, creating, uploading, setNamespaceLocked]);
  function remove(row: DocumentSummary) {
    const target = { kind, namespaceId: namespace, name: documentName(row) };
    Modal.confirm({ title: `删除 ${meta.title} 资源？`, content: `${target.name}（命名空间 ${target.namespaceId || 'public'}）：所有版本和内容都会删除。`,
      okText: '删除资源', okButtonProps: { status: 'danger' }, onOk: async () => {
        try { await documentsApi.mutate(target, '', {}, 'DELETE'); Message.success('资源已删除'); resource.reload(); }
        catch (error) { showError(error); throw error; }
      } });
  }
  async function precheck(nextFile?: File) {
    setFile(nextFile); setChecks(undefined);
    if (!nextFile || kind !== 'skill') return;
    setBusy(true);
    try { setChecks(await documentsApi.precheck(uploadNamespace, nextFile)); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  const check = checks?.length === 1 ? checks[0] : undefined;
  const uploadAllowed = kind === 'agentspec' || !!check && ['READY', 'VERSION_ADJUSTED', 'DRAFT_EXISTS'].includes(check.precheckCode);
  function upload() {
    if (!file || kind === 'prompt' || !uploadAllowed) return;
    const targetKind = kind;
    Modal.confirm({ title: check?.precheckCode === 'DRAFT_EXISTS' ? '覆盖已有草稿？' : '上传 ZIP 创建草稿？',
      content: <div><p>命名空间：{uploadNamespace || 'public'}</p><p>{check?.skillName || file.name}</p>
        {check?.precheckCode === 'DRAFT_EXISTS' && <p>原草稿 {check.editingVersion} 内容会被整个包替换。</p>}
        {targetKind === 'agentspec' && <p>使用服务端默认非覆盖上传；已有工作版本时由服务端拒绝。</p>}</div>,
      okText: check?.precheckCode === 'DRAFT_EXISTS' ? '覆盖草稿' : '上传', onOk: async () => {
        setBusy(true);
        try { await documentsApi.upload(targetKind, uploadNamespace, file, check); Message.success('ZIP 已上传为草稿'); setUploading(false); setFile(undefined); setChecks(undefined); resource.reload(); }
        catch (error) { showError(error); throw error; }
        finally { setBusy(false); }
      } });
  }
  return <div className="page-stack">
    <div className="page-heading"><Typography.Title heading={4}>{meta.title} 管理</Typography.Title><Tag>Namespace · {namespace || 'public'}</Tag></div>
    <Card bordered={false}><Form form={filter} layout="inline" className="filter-form" onSubmit={(values) => {
      setQuery({ name: values.name || '', owner: values.owner || '', scope: values.scope || '' }); setPagination({ ...pagination, current: 1 });
    }}>
      <Form.Item field="name" label="名称"><Input allowClear placeholder={`搜索 ${meta.title}`} /></Form.Item>
      {kind !== 'prompt' && <><Form.Item field="owner" label="所有者"><Input allowClear placeholder="用户名" /></Form.Item>
        <Form.Item field="scope" label="可见范围"><Select allowClear style={{ width: 150 }} options={['PUBLIC', 'PRIVATE']} /></Form.Item></>}
      <Space><Button htmlType="submit" type="primary" icon={<IconSearch />}>查询</Button><Button onClick={() => {
        filter.resetFields(); setQuery({ name: '', owner: '', scope: '' }); setPagination({ ...pagination, current: 1 });
      }}>重置</Button></Space>
    </Form></Card>
    <Card bordered={false}><div className="table-toolbar"><Space>
      <Button type="primary" icon={<IconPlus />} onClick={() => setCreating({ kind, namespaceId: namespace, name: '' })}>新建草稿</Button>
      {kind !== 'prompt' && <Button icon={<IconUpload />} disabled={session.mode === 'demo'} onClick={() => {
        setUploadNamespace(namespace); setFile(undefined); setChecks(undefined); setUploading(true);
      }}>上传 ZIP</Button>}
      <Typography.Text type="secondary">共 {resource.data?.totalCount ?? '—'} 项{session.mode === 'demo' && kind !== 'prompt' ? ' · 演示模式不提供 ZIP 上传' : ''}</Typography.Text>
    </Space><Button icon={<IconRefresh />} onClick={resource.reload} loading={resource.loading}>刷新</Button></div>
      <RequestError error={resource.error} retry={resource.reload} />
      <Table<DocumentSummary> rowKey={documentName} loading={resource.loading} data={resource.loading ? [] : resource.data?.pageItems || []}
        scroll={{ x: 900 }} pagination={{ ...pagination, total: resource.data?.totalCount || 0, showTotal: true, sizeCanChange: true }}
        onChange={(page) => setPagination({ current: page.current || 1, pageSize: page.pageSize || 10 })}
        columns={[{ title: '名称', width: 220, render: (_, row) => <Button type="text" onClick={() => setSelected({ kind, namespaceId: namespace, name: documentName(row) })}>{documentName(row)}</Button> },
          { title: '描述', dataIndex: 'description', ellipsis: true },
          { title: 'Latest', render: (_, row) => row.labels?.latest || row.latestVersion || '—' },
          { title: '工作版本', render: (_, row) => <Space direction="vertical" size={2}>{row.editingVersion && <Tag>草稿 {row.editingVersion}</Tag>}{row.reviewingVersion && <Tag color="orange">审核 {row.reviewingVersion}</Tag>}{!row.editingVersion && !row.reviewingVersion && '—'}</Space> },
          ...(kind === 'prompt' ? [] : [{ title: '可见范围', render: (_: unknown, row: DocumentSummary) => <AiScopeTag scope={row.scope} /> }, { title: '状态', render: (_: unknown, row: DocumentSummary) => <AiResourceTag enabled={row.enable} /> }]),
          { title: '操作', width: 160, render: (_, row) => <Space size={0}><Button type="text" onClick={() => setSelected({ kind, namespaceId: namespace, name: documentName(row) })}>管理</Button>
            <Button type="text" status="danger" disabled={row.writable === false} onClick={() => remove(row)}>删除</Button></Space> }]} />
    </Card>
    {selected && <DocumentDetail target={selected} close={() => setSelected(null)} changed={resource.reload} />}
    {creating && <DraftEditor target={creating} fresh close={() => setCreating(null)} saved={(target) => { setCreating(null); setSelected(target); resource.reload(); }} />}
    <Modal title={`上传 ${meta.title} ZIP`} visible={uploading} onCancel={() => { if (!busy) setUploading(false); }} onOk={upload}
      okText="确认上传" confirmLoading={busy} okButtonProps={{ disabled: !file || !uploadAllowed || busy }} maskClosable={false}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="info" content={kind === 'skill' ? '选择单 Skill ZIP 后先进行服务端预检。仅支持一个有效 Skill；批量包请拆分上传。' : 'ZIP 包应包含 manifest.json 和引用的资源文件。上传后创建草稿。'} />
        <input ref={fileInput} type="file" accept=".zip,application/zip" disabled={busy} onChange={(event) => void precheck(event.target.files?.[0])} aria-label="选择 ZIP 包" />
        {busy && <Spin />}
        {checks && <><Table<UploadCheck> rowKey={(item) => `${item.skillName || item.reason || 'invalid'}-${item.precheckCode}`}  size="small" pagination={false} data={checks} columns={[
          { title: 'Skill', dataIndex: 'skillName' }, { title: '预检', dataIndex: 'precheckCode' }, { title: '目标版本', dataIndex: 'targetVersion' }, { title: '说明', render: (_, item) => item.reason || (item.owner ? `所有者 ${item.owner}` : '—') },
        ]} />{checks.length !== 1 && <Alert type="warning" content="此页面只支持单 Skill ZIP，请拆分后重新选择。" />}</>}
      </Space>
    </Modal>
  </div>;
}

function DocumentDetail({ target, close, changed }: { target: DocumentTarget; close: () => void; changed: () => void }) {
  const { session, dark } = useConsole();
  const [version, setVersion] = useState('');
  const [editing, setEditing] = useState<{ fresh: boolean; basedOnVersion?: string; version?: string; card?: DocumentCard } | null>(null);
  const [metadata, setMetadata] = useState<'labels' | 'scope' | 'biz-tags' | 'description' | null>(null);
  const [metaText, setMetaText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback((signal: AbortSignal) => documentsApi.detail(target, signal), [target]);
  const resource = useResource(load);
  const meta = resource.data;
  const versions = meta ? documentVersions(meta) : [];
  const chosenVersion = String(version || meta?.editingVersion || meta?.reviewingVersion || meta?.labels?.latest || meta?.latestVersion || versions[0]?.version || '');
  const summary = versions.find((item) => item.version === chosenVersion);
  const loadCard = useCallback((signal: AbortSignal) => chosenVersion ? documentsApi.version(target, chosenVersion, signal) : Promise.resolve(null), [target, chosenVersion]);
  const card = useResource(loadCard);
  const writable = !!meta && !resource.loading && meta.writable !== false;
  const title = documentKinds[target.kind].title;
  function reload() { resource.reload(); card.reload(); changed(); }
  function mutate(operation: string, versionTarget?: string, method = 'POST', params: Params = {}) {
    const label = actionNames[operation] || (operation === 'draft' ? '删除草稿' : '删除资源');
    Modal.confirm({ title: `${label}？`, content: <div><p>{target.name} / {versionTarget || target.namespaceId || 'public'}</p>
      {operation === 'submit' && <p>{summary?.status === 'reviewing' ? '当前审核已有终态结果，服务端将先收敛状态再重新提交。' : '无匹配发布流水线时，提交可能会直接上线。'}</p>}
      {operation === 'force-publish' && <Alert type="warning" content="此操作将绕过当前审核拒绝结果，并使该版本上线。请确认已审查风险。" />}
      {method === 'DELETE' && <p>删除后无法恢复。</p>}</div>, okText: label,
      okButtonProps: { status: method === 'DELETE' || operation === 'force-publish' ? 'danger' : 'default' }, onOk: async () => {
        try {
          if (operation === 'draft' && method === 'DELETE') {
            const current = await documentsApi.detail(target);
            if (!versionTarget || current.editingVersion !== versionTarget) throw new Error('草稿版本已变化，请刷新后重试');
          }
          await documentsApi.mutate(target, operation, { ...params, version: versionTarget }, method); Message.success(`${label}成功`); setVersion(method === 'DELETE' ? '' : versionTarget || chosenVersion); reload(); }
        catch (error) { showError(error); throw error; }
      } });
  }
  async function download() {
    setBusy(true);
    try {
      const blob = await documentsApi.download(target, chosenVersion);
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `${target.name.replace(/[\\/:*?"<>|]/g, '_')}-${chosenVersion}.${target.kind === 'skill' ? 'zip' : 'md'}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  function editMeta(field: typeof metadata) {
    setMetadata(field);
    setMetaText(field === 'labels' ? JSON.stringify(Object.fromEntries(Object.entries(meta?.labels || {}).filter(([key]) => key !== 'latest')), null, 2)
      : field === 'scope' ? meta?.scope || 'PRIVATE' : field === 'description' ? meta?.description || ''
        : Array.isArray(meta?.bizTags) ? JSON.stringify(meta.bizTags, null, 2) : meta?.bizTags || '[]');
  }
  async function saveMeta() {
    if (!metadata) return;
    try {
      const value = metadata === 'labels' ? JSON.stringify(customLabels(metaText, versions)) : metadata === 'biz-tags' ? JSON.stringify(parseTags(metaText)) : metaText;
      await documentsApi.mutate(target, metadata, { [metadata === 'biz-tags' ? 'bizTags' : metadata]: value }, 'PUT');
      Message.success('元数据已更新'); setMetadata(null); reload();
    } catch (error) { showError(error); throw error; }
  }
  return <Drawer visible title={`${title} · ${target.name}`} width="min(1120px, 100vw)" maskClosable={false} onCancel={() => { if (!editing) close(); }} footer={<Button disabled={!!editing} onClick={close}>关闭</Button>}>
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Space><Tag>Namespace · {target.namespaceId || 'public'}</Tag>{meta && target.kind !== 'prompt' && <><AiScopeTag scope={meta.scope} /><AiResourceTag enabled={meta.enable} /></>}
        {meta?.writable === false && <Tag color="orange">只读资源</Tag>}<Button icon={<IconRefresh />} onClick={reload} loading={resource.loading || card.loading}>刷新审核进度</Button></Space>
      <RequestError error={resource.error} retry={resource.reload} />
      {meta && !resource.loading && <>
        <Descriptions column={2} data={[{ label: '描述', value: meta.description || '—' }, { label: '所有者', value: meta.owner || '—' },
          { label: 'Latest', value: meta.labels?.latest || meta.latestVersion || '—' }, { label: '在线版本数', value: meta.onlineCnt ?? 0 },
          { label: '标签', value: JSON.stringify(meta.labels || {}) }, { label: '业务标签', value: Array.isArray(meta.bizTags) ? meta.bizTags.join(', ') : meta.bizTags || '—' }]} />
        <Space wrap><Button disabled={!writable || !!meta.editingVersion || !!meta.reviewingVersion} type="primary" onClick={() => setEditing({ fresh: true, basedOnVersion: chosenVersion || undefined })}>派生新草稿</Button>
          <Button disabled={!writable} onClick={() => editMeta('labels')}>自定义版本标签</Button><Button disabled={!writable} onClick={() => editMeta('biz-tags')}>业务标签</Button>
          {target.kind === 'prompt' ? <Button disabled={!writable} onClick={() => editMeta('description')}>修改描述</Button> : <>
            <Button disabled={!writable} onClick={() => editMeta('scope')}>修改可见范围</Button>
            <Button disabled={!writable} onClick={() => mutate(meta.enable === false ? 'online' : 'offline', undefined, 'POST', { scope: target.kind })}>{meta.enable === false ? '启用资源' : '禁用资源'}</Button>
          </>}
        </Space>
        <Table<DocumentVersion> rowKey="version" size="small" data={versions} pagination={{ pageSize: 8 }} columns={[
          { title: '版本', dataIndex: 'version', render: (value) => <Button type={value === chosenVersion ? 'primary' : 'text'} size="mini" onClick={() => setVersion(value)}>{value}</Button> },
          { title: '状态', render: (_, item) => <AiVersionTag status={item.status} pipeline={item.publishPipelineInfo} /> },
          { title: '作者', render: (_, item) => item.author || item.srcUser || '—' }, { title: '提交说明', render: (_, item) => item.commitMsg || item.description || '—' },
        ]} />
        {summary && <Space wrap><AiVersionTag status={summary.status} pipeline={summary.publishPipelineInfo} />
          {summary.status === 'draft' && <><Button disabled={!writable || card.loading || !card.data} onClick={() => setEditing({ fresh: false, version: chosenVersion, card: card.data || undefined })}>编辑草稿</Button>
            <Button disabled={!writable} status="danger" onClick={() => mutate('draft', chosenVersion, 'DELETE')}>删除草稿</Button></>}
          {canSubmitDocument(writable, summary) && <Button onClick={() => mutate('submit', chosenVersion)}>{summary.status === 'reviewing' ? '恢复并重新提交审核' : '提交审核'}</Button>}
          {summary.status === 'reviewed' && <><Button disabled={!writable || pipelineState(summary.publishPipelineInfo) !== 'APPROVED'} type="primary" onClick={() => mutate('publish', chosenVersion)}>发布审核通过版本</Button>
            <Button disabled={!writable} onClick={() => mutate('redraft', chosenVersion)}>退回草稿</Button></>}
          {canForcePublishDocument(session.globalAdmin, writable, summary) && <Button status="danger" disabled={!writable} onClick={() => mutate('force-publish', chosenVersion)}>管理员强制发布</Button>}
          {['online', 'offline'].includes(summary.status) && <Button disabled={!writable} onClick={() => mutate(summary.status === 'online' ? 'offline' : 'online', chosenVersion)}>{summary.status === 'online' ? '下线版本' : '上线版本'}</Button>}
          {target.kind !== 'agentspec' && <Button loading={busy} onClick={download}>下载此版本{target.kind === 'skill' ? ' ZIP' : ''}</Button>}
        </Space>}
        {summary?.publishPipelineInfo != null && <Card title="发布审核结果" size="small"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{typeof summary.publishPipelineInfo === 'string' ? summary.publishPipelineInfo : JSON.stringify(summary.publishPipelineInfo, null, 2)}</pre></Card>}
        <RequestError error={card.error} retry={card.reload} />
        {card.loading ? <Spin /> : card.data && <Tabs defaultActiveTab="content"><Tabs.TabPane key="content" title={`版本 ${chosenVersion} 内容`}>
          <Suspense fallback={<Spin />}><Editor value={card.data.template ?? card.data.skillMd ?? card.data.content ?? ''} type={target.kind === 'agentspec' ? 'json' : 'text'} readOnly dark={dark} height={420} /></Suspense>
        </Tabs.TabPane><Tabs.TabPane key="resources" title={target.kind === 'prompt' ? '变量定义' : '资源文件'}>
          <Suspense fallback={<Spin />}><Editor value={JSON.stringify(target.kind === 'prompt' ? card.data.variables || [] : card.data.resource || {}, null, 2)} type="json" readOnly dark={dark} height={350} /></Suspense>
        </Tabs.TabPane></Tabs>}
      </>}
    </Space>
    {editing && <DraftEditor target={target} fresh={editing.fresh} basedOnVersion={editing.basedOnVersion} version={editing.version} card={editing.card} close={() => setEditing(null)} saved={() => { setEditing(null); setVersion(''); reload(); }} />}
    <Modal title={metadata === 'scope' ? '确认修改资源可见范围' : metadata === 'labels' ? '编辑自定义版本标签' : metadata === 'description' ? '修改描述' : '编辑业务标签'}
      visible={!!metadata} onCancel={() => setMetadata(null)} onOk={saveMeta} maskClosable={false}>
      <Space direction="vertical" style={{ width: '100%' }}><Typography.Text type="secondary">{target.name} · {target.namespaceId || 'public'}</Typography.Text>
        {metadata === 'labels' && <Alert type="info" content="latest 由服务端维护。这里只编辑自定义标签，格式如 {&quot;stable&quot;:&quot;1.0.0&quot;}。" />}
        {metadata === 'scope' ? <><Alert type="warning" content="PUBLIC 资源可被其他用户读取；PRIVATE 按服务端可见性插件规则限制访问。" /><Input value={metaText} onChange={setMetaText} placeholder="PUBLIC / PRIVATE 或插件支持的 scope" /></>
          : <Input.TextArea value={metaText} onChange={setMetaText} autoSize={{ minRows: 5, maxRows: 14 }} placeholder={metadata === 'biz-tags' ? '["tag"]' : ''} />}
      </Space>
    </Modal>
  </Drawer>;
}
function parseTags(raw: string): string[] {
  const tags: unknown = JSON.parse(raw);
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) throw new Error('业务标签需要 JSON 字符串数组');
  return tags;
}

function DraftEditor({ target, fresh, basedOnVersion, version, card, close, saved }: {
  target: DocumentTarget; fresh: boolean; basedOnVersion?: string; version?: string; card?: DocumentCard;
  close: () => void; saved: (target: DocumentTarget) => void;
}) {
  const { dark } = useConsole();
  const [form] = Form.useForm();
  const [content, setContent] = useState(card?.template ?? card?.skillMd ?? card?.content ?? (target.kind === 'agentspec' ? '{}' : ''));
  const [auxiliary, setAuxiliary] = useState(JSON.stringify(target.kind === 'prompt' ? card?.variables || [] : card?.resource || {}, null, 2));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);
  const [originalContent] = useState(content);
  const [originalAuxiliary] = useState(auxiliary);
  const isDirty = dirty || content !== originalContent || auxiliary !== originalAuxiliary;
  useEffect(() => {
    if (!isDirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [isDirty]);
  function cancel() {
    if (saving) return;
    if (isDirty) Modal.confirm({ title: '放弃未保存修改？', content: '当前编辑内容尚未保存到草稿。', okText: '放弃修改', cancelText: '继续编辑', onOk: close });
    else close();
  }
  async function save() {
    let values: { name: string; description: string; targetVersion?: string; commitMsg?: string };
    try { values = await form.validate(); } catch { return; }
    const captured = { ...target, name: target.name || values.name.trim() };
    setSaving(true);
    try {
      if (!fresh && version) {
        const current = await documentsApi.detail(captured);
        if (current.editingVersion !== version) throw new Error('草稿版本已变化，当前内容未保存。请关闭并刷新后重试');
      }
      if (fresh && basedOnVersion && !created) {
        await documentsApi.mutate(captured, 'draft', { basedOnVersion, targetVersion: values.targetVersion || undefined, ...(target.kind !== 'agentspec' ? { commitMsg: values.commitMsg } : {}) });
        Message.success('已从所选版本创建草稿'); saved(captured); return;
      }
      if (!content.trim()) throw new Error('请输入内容');
      const nextCard: DocumentCard = { ...card, description: values.description, commitMsg: values.commitMsg };
      if (target.kind === 'prompt') { nextCard.template = content; nextCard.variables = parseVariables(auxiliary); }
      else {
        nextCard.resource = parseResources(auxiliary);
        if (target.kind === 'skill') nextCard.skillMd = content;
        else {
          const manifest: unknown = JSON.parse(content);
          if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest.json 必须是 JSON 对象');
          nextCard.content = content;
        }
      }
      if (fresh && target.kind === 'agentspec' && !created) {
        await documentsApi.mutate(captured, 'draft', { targetVersion: values.targetVersion || undefined });
        setCreated(true);
      }
      await documentsApi.saveDraft(captured, nextCard, fresh && target.kind !== 'agentspec', values.targetVersion || undefined);
      Message.success('草稿已保存'); saved(captured);
    } catch (error) { showError(error); }
    finally { setSaving(false); }
  }
  return <Drawer visible title={fresh ? basedOnVersion ? `从 ${basedOnVersion} 派生草稿` : `新建 ${documentKinds[target.kind].title} 草稿` : `编辑 ${target.name} 草稿`}
    width="min(960px, 100vw)" maskClosable={false} onCancel={cancel} footer={<Space><Button disabled={saving} onClick={cancel}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存草稿</Button></Space>}>
    <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} initialValues={{ name: target.name, description: card?.description || '', commitMsg: card?.commitMsg || '' }}>
      <Alert type="info" content={`命名空间：${target.namespaceId || 'public'}。保存只写入草稿，发布需要单独提交。`} />
      {created && <Alert type="warning" content="空草稿已创建，内容尚未全部保存。请继续保存；也可关闭后从版本管理重新编辑该草稿。" />}
      <Form.Item field="name" label="资源名称" rules={[{ required: true, match: /\S/, message: '请输入资源名称' }]}><Input disabled={!!target.name || created} placeholder={target.kind === 'skill' ? '小写字母、数字和连字符，与 SKILL.md name 一致' : '稳定资源名称'} /></Form.Item>
      {fresh && <Form.Item field="targetVersion" label="目标版本（可选，由服务端校验并生成）"><Input disabled={created} placeholder="例如 1.0.0" /></Form.Item>}
      {!basedOnVersion && <Form.Item field="description" label={target.kind === 'skill' ? '描述（SKILL.md 中的 description 优先）' : '描述'} rules={target.kind === 'skill' ? [{ required: true, match: /\S/, message: '请输入 Skill 描述' }] : []}><Input /></Form.Item>}
      {target.kind !== 'agentspec' && <Form.Item field="commitMsg" label="版本提交说明"><Input /></Form.Item>}
      {!basedOnVersion && <><Form.Item label={target.kind === 'prompt' ? 'Prompt 模板' : target.kind === 'skill' ? 'SKILL.md（含 name / description frontmatter）' : 'manifest.json'} required>
        <Suspense fallback={<Spin />}><Editor value={content} onChange={setContent} type={target.kind === 'agentspec' ? 'json' : 'text'} dark={dark} height={380} /></Suspense>
      </Form.Item><Form.Item label={target.kind === 'prompt' ? '变量定义 JSON' : '完整资源文件 JSON（保存时整体替换）'}>
        <Typography.Paragraph type="secondary">{target.kind === 'prompt' ? '每项包含 name、defaultValue、description。' : '映射格式：{"path":{"name":"path","type":"text","content":"...","metadata":null}}。保留所有需继续使用的文件，空文件内容可为空字符串。'}</Typography.Paragraph>
        <Suspense fallback={<Spin />}><Editor value={auxiliary} onChange={setAuxiliary} type="json" dark={dark} height={240} /></Suspense>
      </Form.Item></>}
    </Form>
  </Drawer>;
}
