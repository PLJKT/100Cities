import { Form, Input, Button, Card, Space } from 'antd';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import api from '../../services/api';
import LangSwitcher from '../../components/LangSwitcher';

export default function Login() {
  const { t } = useTranslation();
  const nav = useNavigate();

  // 已登录用户直接跳到业务平台
  useEffect(() => {
    if (localStorage.getItem('token')) nav('/app/dashboard', { replace: true });
  }, [nav]);

  const onFinish = async (values: { username: string; password: string }) => {
    try {
      const { data } = await api.post('/auth/login', values);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      nav('/app/dashboard');
    } catch {
      // 错误提示由全局拦截处理
    }
  };

  return (
    <div style={{ maxWidth: 380, margin: '80px auto' }}>
      <div style={{ textAlign: 'right', marginBottom: 12 }}>
        <LangSwitcher />
      </div>
      <Card title={t('login.title')}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="username" label={t('login.username')} rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label={t('login.password')} rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>{t('login.submit')}</Button>
        </Form>
        <Space style={{ marginTop: 12, justifyContent: 'center', width: '100%' }}>
          <Link to="/">← {t('login.back')}</Link>
        </Space>
      </Card>
    </div>
  );
}
