import { Button, Card, Col, Descriptions, Drawer, Form, Input, Row, Select, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';

const CATS = ['industrial', 'residential', 'commercial', 'power', 'water', 'dryport', 'sez', 'infra', 'education'];
const STATUS_COLOR: Record<string, string> = {
  available: 'green',
  reserved: 'gold',
  leased: 'orange',
  planning: 'blue',
};
const CAT_COLOR: Record<string, string> = {
  industrial: 'blue',
  sez: 'purple',
  power: 'gold',
  water: 'cyan',
  dryport: 'geekblue',
  education: 'green',
  residential: 'magenta',
  commercial: 'volcano',
  infra: 'default',
};

export default function Assets() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [cat, setCat] = useState<string | undefined>();
  const [detail, setDetail] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [matchForm] = Form.useForm();
  const [matched, setMatched] = useState<any[] | null>(null);
  const [matching, setMatching] = useState(false);

  const load = (c?: string) => {
    setLoading(true);
    api
      .get(c ? `/assets/category/${c}` : '/assets')
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(cat); }, [cat]);

  const catLabel = (c: string) => t(`assets.cat.${c}`) || c;
  const stLabel = (s: string) => t(`assets.st.${s}`) || s;

  const showDetail = (row: any) => { setDetail(row); setOpen(true); };

  const doMatch = async () => {
    const v = await matchForm.validateFields();
    setMatching(true);
    try {
      const r = await api.post('/assets/match', {
        industry: v.industry || undefined,
        company_size: v.company_size || undefined,
        need_area: v.need_area || undefined,
      });
      setMatched(r.data?.results || []);
    } catch { setMatched([]); }
    setMatching(false);
  };

  const cols: ColumnsType<any> = [
    { title: t('assets.name'), dataIndex: 'name', key: 'name', render: (v: string, r) => (
        <a onClick={() => showDetail(r)} style={{ fontWeight: 600 }}>{v}</a>
      ) },
    { title: t('assets.category'), dataIndex: 'category', key: 'cat', width: 130, render: (v: string) => (
        <Tag color={CAT_COLOR[v] || 'default'}>{catLabel(v)}</Tag>
      ) },
    { title: t('assets.location'), dataIndex: 'location', key: 'loc', width: 170, responsive: ['md'], ellipsis: true },
    { title: t('assets.size'), dataIndex: 'size_desc', key: 'size', width: 140, responsive: ['lg'] },
    { title: t('assets.price'), dataIndex: 'price_desc', key: 'price', width: 200, ellipsis: true, render: (v: string) => (
        <span style={{ fontSize: 12 }}>{v || '—'}</span>
      ) },
    { title: t('assets.status'), dataIndex: 'status', key: 'status', width: 110, render: (v: string) => (
        <Tag color={STATUS_COLOR[v] || 'default'}>{stLabel(v)}</Tag>
      ) },
    { title: t('assets.specs'), dataIndex: 'key_specs', key: 'specs', ellipsis: true, responsive: ['xl'], render: (v: string) => (
        <span style={{ fontSize: 12 }}>{v || '—'}</span>
      ) },
    { title: t('assets.contact'), dataIndex: 'owner_contact', key: 'contact', width: 200, ellipsis: true, responsive: ['xl'], render: (v: string) => (
        <span style={{ fontSize: 12 }}>{v || '—'}</span>
      ) },
  ];

  const available = rows.filter((x) => x.status === 'available').length;
  const engaged = rows.filter((x) => x.status === 'reserved' || x.status === 'leased').length;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={12} sm={8}><Card><Statistic title={t('assets.total')} value={rows.length} /></Card></Col>
      <Col xs={12} sm={8}><Card><Statistic title={t('assets.available')} value={available} /></Card></Col>
      <Col xs={12} sm={8}><Card><Statistic title={t('assets.reserved')} value={engaged} /></Card></Col>

      <Col span={24}>
        <Card
          title={t('assets.title')}
          extra={
            <Select
              allowClear
              placeholder={t('assets.sectors')}
              style={{ width: 200 }}
              value={cat}
              onChange={(v) => setCat(v)}
              options={CATS.map((c) => ({ value: c, label: catLabel(c) }))}
            />
          }
        >
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>{t('assets.lead')}</Typography.Paragraph>
          <Table
            rowKey="id"
            loading={loading}
            columns={cols}
            dataSource={rows}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            scroll={{ x: 1100 }}
            size="middle"
            onRow={(r) => ({ onClick: () => showDetail(r), style: { cursor: 'pointer' } })}
          />
        </Card>
      </Col>

      {/* 考察匹配 */}
      <Col span={24}>
        <Card title={t('assets.match')}>
          <Form form={matchForm} layout="inline" onFinish={doMatch} style={{ rowGap: 12, flexWrap: 'wrap' }}>
            <Form.Item name="industry" label={t('assets.industry')}>
              <Input placeholder="e.g. Electronics" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="company_size" label={t('assets.companySize')}>
              <Select allowClear style={{ width: 140 }} options={['SME', 'Mid', 'Large', 'Enterprise'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="need_area" label={t('assets.needArea')}>
              <Input placeholder="e.g. 20,000 m²" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={matching}>{t('assets.matchRun')}</Button>
            </Form.Item>
          </Form>
          {matched && (
            <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
              {matched.map((m: any) => (
                <Col xs={24} md={12} xl={8} key={m.id}>
                  <Card
                    size="small"
                    title={<a onClick={() => showDetail(m)}>{m.name}</a>}
                    extra={<Tag color="gold">{t('assets.matchScore')}: {m.match_score}</Tag>}
                  >
                    <div style={{ fontSize: 12, color: '#595959' }}>
                      <div>{catLabel(m.category)} · {m.location}</div>
                      <div>{m.size_desc}</div>
                      <div style={{ marginTop: 4 }}>{m.price_desc}</div>
                    </div>
                  </Card>
                </Col>
              ))}
              {matched.length === 0 && <Typography.Text type="secondary" style={{ marginLeft: 16 }}>{t('assets.matchHint')}</Typography.Text>}
            </Row>
          )}
        </Card>
      </Col>

      {/* 详情抽屉 */}
      <Drawer
        title={t('assets.detail')}
        width={Math.min(560, window.innerWidth - 32)}
        open={open}
        onClose={() => setOpen(false)}
      >
        {detail && (
          <>
            <h3 style={{ marginTop: 0 }}>{detail.name}</h3>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t('assets.category')}><Tag color={CAT_COLOR[detail.category] || 'default'}>{catLabel(detail.category)}</Tag></Descriptions.Item>
              <Descriptions.Item label={t('assets.status')}><Tag color={STATUS_COLOR[detail.status] || 'default'}>{stLabel(detail.status)}</Tag></Descriptions.Item>
              <Descriptions.Item label={t('assets.location')}>{detail.location || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('assets.size')}>{detail.size_desc || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('assets.minArea')}>{detail.min_area || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('assets.maxArea')}>{detail.max_area || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('assets.price')}>{detail.price_desc || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('assets.specs')}>{detail.key_specs || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('assets.contact')}>{detail.owner_contact || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('assets.description')}>{detail.description || '—'}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>
    </Row>
  );
}
