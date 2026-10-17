import { Layout, Menu, Space, Button } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LangSwitcher from '../components/LangSwitcher';

const { Header, Sider, Content } = Layout;

export default function AdminLayout() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const loc = useLocation();

  const items = [
    { key: '/dashboard', label: t('nav.dashboard') },
    { key: '/partner/form', label: t('nav.partnerForm') },
    { key: '/partner/my', label: t('nav.mySubmits') },
    { key: '/review', label: t('nav.review') },
    { key: '/admin/users', label: t('nav.users') },
    { key: '/admin/roles', label: t('nav.roles') },
    { key: '/admin/templates', label: t('nav.templates') },
  ];

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    nav('/login');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#fff', fontWeight: 600 }}>{t('app.name')} — {t('app.phase1')}</div>
        <Space>
          <LangSwitcher />
          <Button size="small" onClick={() => nav('/portal')}>{t('nav.portal')}</Button>
          <Button size="small" onClick={logout}>{t('nav.logout')}</Button>
        </Space>
      </Header>
      <Layout>
        <Sider width={220}>
          <Menu
            mode="inline"
            selectedKeys={[loc.pathname]}
            items={items}
            onClick={({ key }) => nav(key)}
            style={{ height: '100%' }}
          />
        </Sider>
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
