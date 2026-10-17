import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import LangSwitcher from '../components/LangSwitcher';
import { useTranslation } from 'react-i18next';

export default function PortalLayout() {
  const { t } = useTranslation();
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ background: '#001529', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
        <b>{t('app.name')}</b>
        <LangSwitcher />
      </Layout.Header>
      <Layout.Content style={{ padding: 40 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
