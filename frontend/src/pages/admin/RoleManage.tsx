import { Card, Table } from 'antd';

export default function RoleManage() {
  return (
    <Card title="Role & Permission">
      <Table rowKey="id" pagination={false}
        dataSource={[
          { id: 1, role_name: 'Super Admin', scope: 'all' },
          { id: 2, role_name: 'Partner Filler', scope: 'self' },
          { id: 3, role_name: 'Reviewer', scope: 'review' },
          { id: 4, role_name: 'BOD Read-only', scope: 'summary' },
        ]}
        columns={[
          { title: 'ID', dataIndex: 'id' },
          { title: 'Role', dataIndex: 'role_name' },
          { title: 'Data Scope', dataIndex: 'scope' },
        ]} />
    </Card>
  );
}
