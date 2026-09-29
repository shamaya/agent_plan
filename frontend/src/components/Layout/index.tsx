import { useState, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppRoutes } from '../../router';
import { Layout as AntLayout, Menu, Input, Typography, Space, Spin } from 'antd';
import {
  DashboardOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  ClusterOutlined,
  BookOutlined,
  RobotOutlined,
  MessageOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  KeyOutlined,
} from '@ant-design/icons';

const { Sider, Header, Content } = AntLayout;

// 菜单项（与路由对齐）
const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/providers', icon: <ApiOutlined />, label: 'LLM Provider' },
  { key: '/skills', icon: <ThunderboltOutlined />, label: 'Skill 管理' },
  { key: '/mcp', icon: <ClusterOutlined />, label: 'MCP 服务' },
  { key: '/knowledge', icon: <BookOutlined />, label: '知识库' },
  { key: '/agents', icon: <RobotOutlined />, label: 'Agent' },
  { key: '/chat', icon: <MessageOutlined />, label: '对话' },
  { key: '/traces', icon: <LineChartOutlined />, label: '监控 Trace' },
  { key: '/harness', icon: <SafetyCertificateOutlined />, label: 'Harness 工程' },
  { key: '/apikeys', icon: <KeyOutlined />, label: '第三方接入' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [masterKey, setMasterKey] = useState(
    () => localStorage.getItem('agent_master_key') || '',
  );

  // 高亮当前路径（取最长前缀匹配）
  const selectedKey =
    menuItems
      .map((m) => m.key)
      .filter((k) => location.pathname.startsWith(k) && k !== '/')
      .sort((a, b) => b.length - a.length)[0] ||
    (location.pathname === '/' ? '/' : '');

  const persistKey = (val: string) => {
    setMasterKey(val);
    if (val) localStorage.setItem('agent_master_key', val);
    else localStorage.removeItem('agent_master_key');
  };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        className="app-sider"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        width={232}
        collapsedWidth={68}
      >
        <div className="app-brand">
          <div className="app-brand-mark">A</div>
          {!collapsed && <span className="app-brand-text">Agent 开发平台</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <AntLayout>
        <Header className="app-header">
          <span className="app-header-title">
            {menuItems.find((m) => m.key === selectedKey)?.label || 'Agent 开发平台'}
          </span>
          <Space size={12}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Master Key
            </Typography.Text>
            <Input.Password
              value={masterKey}
              onChange={(e) => persistKey(e.target.value)}
              placeholder="可选，鉴权用"
              style={{ width: 240 }}
            />
          </Space>
        </Header>
        <Content className="app-content">
          <Suspense
            fallback={
              <div style={{ textAlign: 'center', padding: 48 }}>
                <Spin size="large" />
              </div>
            }
          >
            <AppRoutes />
          </Suspense>
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
