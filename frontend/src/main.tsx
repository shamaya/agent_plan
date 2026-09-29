import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#6366f1',
          colorInfo: '#6366f1',
          colorLink: '#4f46e5',
          colorBgLayout: '#f7f8fc',
          borderRadius: 10,
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif",
          fontSize: 14,
          wireframe: false,
          controlHeight: 34,
        },
        components: {
          Layout: {
            siderBg: 'transparent',
            headerBg: '#ffffff',
            headerHeight: 60,
            bodyBg: '#f7f8fc',
          },
          Menu: {
            itemBg: 'transparent',
            itemColor: 'rgba(226,232,240,0.78)',
            itemHoverColor: '#ffffff',
            itemHoverBg: 'rgba(255,255,255,0.06)',
            itemSelectedBg: 'rgba(99,102,241,0.22)',
            itemSelectedColor: '#ffffff',
            itemActiveBg: 'rgba(99,102,241,0.22)',
            darkItemBg: 'transparent',
            darkItemColor: 'rgba(226,232,240,0.78)',
            darkItemHoverBg: 'rgba(255,255,255,0.06)',
            darkItemSelectedBg: 'rgba(99,102,241,0.22)',
            darkItemSelectedColor: '#ffffff',
            darkItemHoverColor: '#ffffff',
            itemHeight: 40,
            iconSize: 16,
          },
          Card: {
            borderRadiusLG: 12,
            headerBg: 'transparent',
            headerFontSize: 15,
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            rowHoverBg: '#f8fafc',
            borderColor: '#e2e8f0',
            headerSplitColor: '#e2e8f0',
            cellPaddingBlock: 12,
          },
          Button: {
            primaryShadow: '0 1px 2px rgba(99,102,241,0.25)',
            defaultBorderColor: '#e2e8f0',
            borderRadius: 8,
            controlHeight: 34,
          },
          Input: {
            borderRadius: 8,
            controlHeight: 34,
            activeBorderColor: '#6366f1',
          },
          Select: {
            borderRadius: 8,
            controlHeight: 34,
          },
          Tag: {
            borderRadiusSM: 6,
          },
          Statistic: {
            contentFontSize: 26,
          },
          Drawer: {
            borderRadiusLG: 12,
          },
          Tooltip: {
            borderRadius: 8,
          },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
