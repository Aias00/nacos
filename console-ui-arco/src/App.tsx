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
// Layout follows the Arco Design Pro Vite template. See THIRD_PARTY_NOTICES.md.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Avatar, Breadcrumb, Button, Dropdown, Layout, Menu, Result, Select, Space, Spin, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { IconApps, IconDashboard, IconFile, IconMenuFold, IconMenuUnfold, IconMoon, IconPoweroff, IconRobot, IconSettings, IconSun, IconThunderbolt, IconUser } from '@arco-design/web-react/icon';
import { api } from './api';
import { Context } from './context';
import { readSession, readStorage, runtime, sessionEvent, storageKey, writeSession, writeStorage } from './session';
import { useResource } from './useResource';
import type { Namespace, Session } from './types';
import Login from './Login';

const Overview = lazy(() => import('./pages/Overview'));
const Configs = lazy(() => import('./pages/Configs'));
const History = lazy(() => import('./pages/History'));
const Listeners = lazy(() => import('./pages/Listeners'));
const Services = lazy(() => import('./pages/Services'));
const Namespaces = lazy(() => import('./pages/Namespaces'));
const Cluster = lazy(() => import('./pages/Cluster'));
const Access = lazy(() => import('./pages/Access'));
const Registries = lazy(() => import('./pages/ai/Registries'));
const Documents = lazy(() => import('./pages/ai/Documents'));
const Copilot = lazy(() => import('./pages/ai/Copilot'));
const labels: Record<string, string> = {
  overview: '工作台', configs: '配置列表', history: '历史版本', listeners: '监听查询',
  services: '服务列表', subscribers: '订阅者查询', namespaces: '命名空间', cluster: '集群管理', access: '权限管理',
  mcp: 'MCP 服务', agents: 'Agent 管理', skills: 'Skill 管理', prompts: 'Prompt 管理', agentspecs: 'AgentSpec 管理', copilot: 'Copilot 设置',
};

function Shell({ session }: { session: Session }) {
  const location = useLocation();
  const navigate = useNavigate();
  const page = location.pathname.split('/')[1] || 'overview';
  const namespaceSuffix = `namespace.${session.mode}.${encodeURIComponent(session.username)}`;
  const [selectedNamespace, updateNamespace] = useState(() => readStorage(namespaceSuffix) || 'public');
  const [namespaceLocked, setNamespaceLocked] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openMenus, setOpenMenus] = useState(['config', 'naming', 'ai', 'platform']);
  const [dark, setDark] = useState(readStorage('theme') === 'dark');
  const loadNamespaces = useCallback((signal: AbortSignal) => api.namespaces(signal), []);
  const namespaceResource = useResource(loadNamespaces);
  const namespaces: Namespace[] = namespaceResource.data || [];
  const { enableAi, enableCopilot } = runtime();
  const namespace = namespaces.some((item) => item.namespace === selectedNamespace)
    ? selectedNamespace : namespaces[0]?.namespace || 'public';
  const ready = !namespaceResource.loading;
  const namespaceError = namespaceResource.error;
  const refreshNamespaces = namespaceResource.reload;
  const reloadNamespaces = useCallback(async () => { refreshNamespaces(); }, [refreshNamespaces]);
  useEffect(() => {
    document.body.setAttribute('arco-theme', dark ? 'dark' : 'light');
    writeStorage('theme', dark ? 'dark' : 'light');
  }, [dark]);
  const changeNamespace = (id: string) => {
    updateNamespace(id);
    writeStorage(namespaceSuffix, id);
  };
  const adminPage = (element: React.ReactNode) => session.globalAdmin ? element
    : <Result status="403" title="暂无访问权限" subTitle="请联系管理员分配权限" />;
  const featurePage = (enabled: boolean, element: React.ReactNode) => enabled ? element
    : <Result status="info" title="此功能尚未启用" subTitle="请联系管理员确认此功能是否开放。"
      extra={<Button onClick={() => window.location.reload()}>刷新页面</Button>} />;
  return <Context.Provider value={{ session, namespaces, namespace, setNamespace: changeNamespace,
    reloadNamespaces, dark, namespaceLocked, setNamespaceLocked }}>
    <Layout className="console-layout">
      <Layout.Header className="console-navbar">
        <div className="brand"><IconApps /><span>{runtime().name}</span></div>
        <Space size={16} className="navbar-actions">
          <Space size={8} className="namespace-picker">
            <Typography.Text type="secondary" className="namespace-label">命名空间</Typography.Text>
            <Select aria-label="命名空间" value={namespace} disabled={namespaceLocked || !ready} style={{ width: 220 }}
              onChange={changeNamespace} options={namespaces.map((item) => ({ value: item.namespace,
                label: `${item.namespaceShowName} (${item.namespace || 'public'})` }))} />
          </Space>
          {session.mode === 'demo' && <Tag color="orange">演示环境</Tag>}
          <Tooltip content={dark ? '浅色模式' : '深色模式'}><Button type="text" shape="circle" aria-label={dark ? '浅色模式' : '深色模式'}
            icon={dark ? <IconSun /> : <IconMoon />} onClick={() => setDark(!dark)} /></Tooltip>
          <Dropdown droplist={<Menu onClickMenuItem={() => writeSession(null)}><Menu.Item key="logout"><IconPoweroff /> {session.mode === 'demo' ? '退出演示' : '退出登录'}</Menu.Item></Menu>} position="br">
            <Button type="text" className="user-button"><Avatar size={28}><IconUser /></Avatar><span>{session.username}</span></Button>
          </Dropdown>
        </Space>
      </Layout.Header>
      <Layout.Sider className="console-sider" width={220} collapsedWidth={48} collapsed={collapsed}
        trigger={null} collapsible breakpoint="lg" onCollapse={setCollapsed}>
        <Menu collapse={collapsed} selectedKeys={[page]} openKeys={openMenus}
          onClickSubMenu={(_key, keys) => setOpenMenus(keys)}
          onClickMenuItem={(key) => navigate('/' + key)} style={{ flex: 1 }}>
          <Menu.Item key="overview"><IconDashboard />工作台</Menu.Item>
          <Menu.SubMenu key="config" title={<><IconFile />配置管理</>}>
            <Menu.Item key="configs">配置列表</Menu.Item><Menu.Item key="history">历史版本</Menu.Item><Menu.Item key="listeners">监听查询</Menu.Item>
          </Menu.SubMenu>
          <Menu.SubMenu key="naming" title={<><IconThunderbolt />服务管理</>}>
            <Menu.Item key="services">服务列表</Menu.Item><Menu.Item key="subscribers">订阅者查询</Menu.Item>
          </Menu.SubMenu>
          {enableAi && <Menu.SubMenu key="ai" title={<><IconRobot />AI 资源管理</>}>
            <Menu.Item key="mcp">MCP 服务</Menu.Item><Menu.Item key="agents">Agent 管理</Menu.Item>
            <Menu.Item key="skills">Skill 管理</Menu.Item><Menu.Item key="prompts">Prompt 管理</Menu.Item>
            <Menu.Item key="agentspecs">AgentSpec 管理</Menu.Item>
          </Menu.SubMenu>}
          <Menu.SubMenu key="platform" title={<><IconSettings />平台管理</>}>
            <Menu.Item key="namespaces">命名空间</Menu.Item>
            {session.globalAdmin && <Menu.Item key="cluster">集群管理</Menu.Item>}
            {session.globalAdmin && <Menu.Item key="access">权限管理</Menu.Item>}
            {session.globalAdmin && enableCopilot && <Menu.Item key="copilot">Copilot 设置</Menu.Item>}
          </Menu.SubMenu>
        </Menu>
        <Button type="text" className="sider-toggle" aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          icon={collapsed ? <IconMenuUnfold /> : <IconMenuFold />} onClick={() => setCollapsed(!collapsed)} />
      </Layout.Sider>
      <Layout className="console-body" style={{ marginLeft: collapsed ? 48 : 220 }}>
        <Layout.Content className="console-content">
          <Breadcrumb style={{ marginBottom: 20 }}><Breadcrumb.Item>服务治理</Breadcrumb.Item><Breadcrumb.Item>{labels[page] || '页面'}</Breadcrumb.Item></Breadcrumb>
          {session.mode === 'demo' && <Alert className="demo-banner" type="warning" showIcon
            content="当前为演示环境，所有操作仅作用于独立示例数据。" action={<Button size="small" type="text" onClick={() => writeSession(null)}>切换真实账号</Button>} />}
          {!ready ? <Spin className="page-loading" tip="正在加载控制台" /> : namespaceError
            ? <Result status="error" title="控制台信息加载失败" subTitle="请检查连接和账号权限" extra={<Button type="primary" onClick={reloadNamespaces}>重试</Button>} />
            : <Suspense fallback={<Spin className="page-loading" />}><Routes>
              <Route path="/overview" element={<Overview />} />
              <Route path="/configs" element={<Configs key={namespace} />} />
              <Route path="/history" element={<History key={namespace + location.search} />} />
              <Route path="/listeners" element={<Listeners key={namespace} />} />
              <Route path="/services" element={<Services key={namespace} />} />
              <Route path="/subscribers" element={<Services key={namespace + 'subscribers'} subscribersOnly />} />
              <Route path="/namespaces" element={<Namespaces />} />
              <Route path="/cluster" element={adminPage(<Cluster />)} />
              <Route path="/access" element={adminPage(<Access />)} />
              <Route path="/mcp" element={featurePage(enableAi, <Registries key={namespace + 'mcp'} kind="mcp" />)} />
              <Route path="/agents" element={featurePage(enableAi, <Registries key={namespace + 'agent'} kind="agent" />)} />
              <Route path="/skills" element={featurePage(enableAi, <Documents key={namespace + 'skill'} kind="skill" />)} />
              <Route path="/prompts" element={featurePage(enableAi, <Documents key={namespace + 'prompt'} kind="prompt" />)} />
              <Route path="/agentspecs" element={featurePage(enableAi, <Documents key={namespace + 'agentspec'} kind="agentspec" />)} />
              <Route path="/copilot" element={adminPage(featurePage(enableCopilot, <Copilot />))} />
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/login" element={<Navigate to="/overview" replace />} />
              <Route path="*" element={<Result status="404" title="页面不存在" extra={<Button onClick={() => navigate('/overview')}>返回工作台</Button>} />} />
            </Routes></Suspense>}
        </Layout.Content>
        <Layout.Footer className="console-footer">{runtime().name} · {enableAi || enableCopilot ? '配置、服务与 AI 资源管理' : '配置与服务管理'}</Layout.Footer>
      </Layout>
    </Layout>
  </Context.Provider>;
}

export default function App() {
  const [session, setSession] = useState(readSession);
  useEffect(() => {
    document.title = runtime().name;
    const sync = () => setSession(readSession());
    const syncStorage = (event: StorageEvent) => { if (event.key === storageKey('session.v1') || event.key === null) sync(); };
    const eventName = sessionEvent();
    window.addEventListener(eventName, sync);
    window.addEventListener('storage', syncStorage);
    return () => { window.removeEventListener(eventName, sync); window.removeEventListener('storage', syncStorage); };
  }, []);
  return <HashRouter>{session ? <Shell key={session.mode + session.username} session={session} />
    : <Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>}</HashRouter>;
}
