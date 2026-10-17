import { Form, Input, Button, Card, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import LangSwitcher from '../../components/LangSwitcher';

export default function Login() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [msg, ctx] = message.useMessage();

  const onFinish = async (values: { username: string; password: string }) => {
    try {
      const { data } = await api.post('/auth/login', values);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      nav('/');
    } catch {
      msg.error(t('login.failed'));
    }
  };

  return (
    <div style={{ maxWidth: 380, margin: '100px auto' }}>
      {ctx}
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
      </Card>
    </div>
  );
}
