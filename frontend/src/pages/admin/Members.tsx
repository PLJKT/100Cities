import { Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';

const TIER_COLOR: Record<string, string> = {
  explorer: 'blue',
  manufacturer: 'green',
  tech: 'purple',
  existing: 'gold',
  investor: 'cyan',
};
const STATUS_COLOR: Record<string, string> = {
  invited: 'default',
  active: 'green',
  paused: 'orange',
};
const STAGE_COLOR: Record<string, string> = {
  intake: 'default',
  matching: 'blue',
  site_visit: 'cyan',
  proposal: 'orange',
  decision: 'green',
};

export default function Members() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .get('/partners')
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const active = rows.filter((x) => x.status === 'active').length;

  const cols: ColumnsType<any> = [
    { title: t('members.company'), dataIndex: 'company_name', key: 'company', render: (v: string, r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{v}</div>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>{r.account?.username || '-'}</div>
        </div>
      ) },
    { title: t('members.nationality'), dataIndex: 'nationality', key: 'nat', width: 90, responsive: ['md'] },
    { title: t('members.industry'), dataIndex: 'industry', key: 'ind', ellipsis: true, responsive: ['lg'] },
    { title: t('members.tier'), dataIndex: 'tier', key: 'tier', width: 130, render: (v: string) => (
        <Tag color={TIER_COLOR[v] || 'default'}>{v}</Tag>
      ) },
    { title: t('members.status'), dataIndex: 'status', key: 'status', width: 100, render: (v: string) => (
        <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag>
      ) },
    { title: t('members.submits'), dataIndex: 'submits', key: 'submits', width: 100, align: 'center', render: (v: number) => (
        <Tag color={v > 0 ? 'green' : 'default'}>{v ?? 0}</Tag>
      ) },
    { title: t('members.leads'), dataIndex: 'leads', key: 'leads', width: 100, align: 'center', render: (v: number) => (
        <Tag color={v > 0 ? 'green' : 'default'}>{v ?? 0}</Tag>
      ) },
    { title: t('members.projects'), dataIndex: 'projects', key: 'projects', width: 100, align: 'center', render: (v: number) => (
        <Tag color={v > 0 ? 'green' : 'default'}>{v ?? 0}</Tag>
      ) },
    { title: t('members.stage'), dataIndex: 'pipeline_stage', key: 'stage', width: 130, render: (v: string | null) =>
        v ? <Tag color={STAGE_COLOR[v] || 'default'}>{v}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span> },
    { title: t('members.lastActive'), dataIndex: 'last_active', key: 'last', width: 170, render: (v: string | null) =>
        v ? <span style={{ fontSize: 12 }}>{v.slice(0, 16)}</span> : <span style={{ color: '#bfbfbf' }}>—</span>, responsive: ['md'] },
  ];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={12} sm={8}><Card><Statistic title={t('members.total')} value={rows.length} /></Card></Col>
      <Col xs={12} sm={8}><Card><Statistic title={t('members.active')} value={active} suffix={`/ ${rows.length}`} /></Card></Col>
      <Col xs={24} sm={8}>
        <Card>
          <Statistic title={t('members.submits')} value={rows.reduce((a, x) => a + (x.submits || 0), 0)} />
        </Card>
      </Col>
      <Col span={24}>
        <Card title={t('members.title')}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            {t('members.lead')}
          </Typography.Paragraph>
          <Table
            rowKey="id"
            loading={loading}
            columns={cols}
            dataSource={rows}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            scroll={{ x: 900 }}
            size="middle"
          />
        </Card>
      </Col>
    </Row>
  );
}
