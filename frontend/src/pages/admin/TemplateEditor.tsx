import { Card, Table, Tag, Typography, Space } from 'antd';
import { useEffect, useState } from 'react';
import api from '../../services/api';

interface FieldRow {
  id: number;
  field_key: string;
  field_type: string;
  required: number;
  sort: number;
  en_label: string;
  id_label?: string;
  zh_label?: string;
  options?: any[] | null;
  enabled: number;
}

interface TemplateRow {
  id: number;
  template_key: string;
  version: number;
  fields: FieldRow[];
}

export default function TemplateEditor() {
  const [tpl, setTpl] = useState<TemplateRow | null>(null);

  useEffect(() => {
    api.get('/admin/templates').then((r) => {
      const list = Array.isArray(r.data) ? r.data : [];
      setTpl(list[0] || null);
    }).catch(() => {});
  }, []);

  return (
    <Card
      title="Form Template Editor"
      extra={
        tpl ? (
          <Space>
            <Tag color="gold">{tpl.template_key}</Tag>
            <Tag>v{tpl.version}</Tag>
          </Space>
        ) : null
      }
    >
      {!tpl ? (
        <Typography.Text type="secondary">Loading template…</Typography.Text>
      ) : (
        <Table<FieldRow>
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={tpl.fields}
          columns={[
            { title: '#', dataIndex: 'sort', width: 48 },
            { title: 'Field Key', dataIndex: 'field_key', width: 180 },
            {
              title: 'Type',
              dataIndex: 'field_type',
              width: 110,
              render: (v: string) => <Tag color={v === 'file' ? 'blue' : v === 'select' || v === 'multiselect' ? 'purple' : 'green'}>{v}</Tag>,
            },
            {
              title: 'Required',
              dataIndex: 'required',
              width: 90,
              render: (v: number) => (v === 1 ? <Tag color="red">Yes</Tag> : <Tag>No</Tag>),
            },
            { title: 'EN', dataIndex: 'en_label' },
            { title: 'ID', dataIndex: 'id_label', responsive: ['md'] },
            { title: 'ZH', dataIndex: 'zh_label', responsive: ['lg'] },
            {
              title: 'Options',
              dataIndex: 'options',
              width: 140,
              render: (o: any[] | null) => (o && o.length ? `${o.length} options` : '—'),
            },
          ]}
        />
      )}
    </Card>
  );
}
