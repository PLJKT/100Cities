import { useEffect, useState } from 'react';
import { Table, Card, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

export default function ReviewList() {
  const [rows, setRows] = useState<any[]>([]);
  const nav = useNavigate();
  useEffect(() => {
    api.get('/review/submits').then((r) => setRows(r.data || [])).catch(() => {});
  }, []);
  return (
    <Card title="Review Submissions">
      <Table rowKey="id" dataSource={rows}
        onRow={(r) => ({ onClick: () => nav(`/review/${r.id}`) })}
        columns={[
          { title: 'Doc No.', dataIndex: 'doc_no' },
          { title: 'Partner', dataIndex: 'partner_name' },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange'}>{s}</Tag> },
          { title: 'Submitted At', dataIndex: 'submit_time' },
        ]} />
    </Card>
  );
}
