import { Card, Col, Row, Statistic } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Column, Pie } from '@ant-design/plots';
import api from '../../services/api';

export default function Dashboard() {
  const { t } = useTranslation();
  const [s, setS] = useState<any>({});
  const [detail, setDetail] = useState<any[]>([]);

  useEffect(() => {
    api.get('/dashboard/summary').then((r) => setS(r.data || {})).catch(() => {});
    // 审核管理员可见明细；BOD 调会 403，前端静默降级
    api.get('/dashboard/detail').then((r) => setDetail(r.data || [])).catch(() => setDetail([]));
  }, []);

  const statusData = Object.entries(
    detail.reduce((acc: any, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {})
  ).map(([type, value]) => ({ type, value }));

  return (
    <Row gutter={[16, 16]}>
      <Col span={8}><Card><Statistic title={t('dash.progress')} value={s.progress ?? 0} suffix="%" /></Card></Col>
      <Col span={8}><Card><Statistic title={t('dash.overdue')} value={s.overdue ?? 0} /></Card></Col>
      <Col span={8}><Card><Statistic title={t('dash.completion')} value={s.completion ?? 0} suffix="%" /></Card></Col>
      <Col span={12}>
        <Card title="Submissions by status"><Pie data={statusData} angleField="value" colorField="type" radius={0.8} /></Card>
      </Col>
      <Col span={12}>
        <Card title="Monthly submissions"><Column data={statusData} xField="type" yField="value" /></Card>
      </Col>
    </Row>
  );
}
