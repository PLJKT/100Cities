import { Card, Table, Button, Modal, Form, Input, message } from 'antd';
import { useEffect, useState } from 'react';
import api from '../../services/api';

export default function UserManage() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [msg, ctx] = message.useMessage();

  const load = () => api.get('/admin/users').then((r) => setRows(r.data || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    const v = await form.validateFields();
    await api.post('/admin/users', v);
    msg.success('Created');
    setOpen(false);
    form.resetFields();
    load();
  };

  return (
    <Card title="User Management" extra={<Button type="primary" onClick={() => setOpen(true)}>Create</Button>}>
      {ctx}
      <Table rowKey="id" dataSource={rows} pagination={false}
        columns={[
          { title: 'Username', dataIndex: 'username' },
          { title: 'Partner', dataIndex: 'partner_name' },
          { title: 'Role', dataIndex: 'role_name' },
          { title: 'Enabled', dataIndex: 'enabled', render: (v) => (v ? 'Yes' : 'No') },
        ]} />
      <Modal open={open} title="Create User" onCancel={() => setOpen(false)} onOk={create}>
        <Form form={form} layout="vertical">
          <Form.Item name="username" rules={[{ required: true }]}><Input placeholder="Username" /></Form.Item>
          <Form.Item name="password" rules={[{ required: true }]}><Input.Password placeholder="Password" /></Form.Item>
          <Form.Item name="partner_name"><Input placeholder="Partner / Company" /></Form.Item>
          <Form.Item name="role_id"><Input placeholder="Role ID" /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
