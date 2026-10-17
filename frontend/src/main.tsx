import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import idID from 'antd/locale/id_ID';
import './i18n';
import App from './App';
import { useTranslation } from 'react-i18next';

function Root() {
  const { i18n } = useTranslation();
  const lang = i18n.language || 'en';
  const antdLocale = lang.startsWith('zh') ? zhCN : lang.startsWith('id') ? idID : enUS;
  return (
    <ConfigProvider locale={antdLocale}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
