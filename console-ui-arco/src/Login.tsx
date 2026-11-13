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
import { Alert, Button, Card, Divider, Form, Input, Space, Typography } from '@arco-design/web-react';
import { IconApps, IconLock, IconUser } from '@arco-design/web-react/icon';
import { api } from './api';
import { runtime, writeSession } from './session';
import { showError } from './utils';

export default function Login() {
  const [busy, setBusy] = useState(false);
  async function login(values: { username: string; password: string }) {
    setBusy(true);
    try {
      const result = await api.login(values.username.trim(), values.password);
      if (!result.accessToken) throw new Error('登录响应缺少访问凭证');
      writeSession({ mode: 'live', accessToken: result.accessToken,
        username: result.username || values.username.trim(), globalAdmin: result.globalAdmin === true });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-brand"><IconApps /> {runtime().name}</div>
    <Card className="login-card" bordered={false}>
      <Typography.Title heading={4}>欢迎登录</Typography.Title>
      <Typography.Paragraph type="secondary">统一管理应用配置与服务注册发现</Typography.Paragraph>
      <Form layout="vertical" onSubmit={login} size="large" autoComplete="on">
        <Form.Item field="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input prefix={<IconUser />} placeholder="请输入用户名" autoComplete="username" />
        </Form.Item>
        <Form.Item field="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<IconLock />} placeholder="请输入密码" autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" long loading={busy}>登录</Button>
      </Form>
      {runtime().enableDemo && <><Divider>预览界面</Divider>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button long size="large" onClick={() => writeSession({ mode: 'demo', accessToken: 'demo-only', username: 'demo', globalAdmin: true })}>体验演示</Button>
          <Alert type="info" content="演示使用独立示例数据，可体验页面与操作。" />
        </Space>
      </>}
    </Card>
    <Typography.Text type="secondary" className="login-footer">配置中心与服务发现管理控制台</Typography.Text>
  </div>;
}
