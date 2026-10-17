import { useEffect, useState } from 'react';
import { Table, Card } from 'antd';
import api from '../../services/api';

export default function MySubmits() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api.get('/forms/my/submits').then((r) => setRows(r.data || [])).catch(() => {});
  }, []);
  return (
    <Card title="My Submissions">
      <Table rowKey="id" dataSource={rows} pagination={false}
        columns={[
          { title: 'Doc No.', dataIndex: 'doc_no' },
          { title: 'Status', dataIndex: 'status' },
          { title: 'Submitted At', dataIndex: 'submit_time' },
          { title: 'Locked', dataIndex: 'locked', render: (v) => (v ? 'Read-only' : 'Draft') },
        ]} />
    </Card>
  );
}
