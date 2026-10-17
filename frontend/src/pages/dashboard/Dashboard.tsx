import { Card, Col, Row, Statistic } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';

export default function Dashboard() {
  const { t } = useTranslation();
  const [s, setS] = useState<any>({});
  useEffect(() => {
    api.get('/dashboard/summary').then((r) => setS(r.data || {})).catch(() => {});
  }, []);
  return (
    <Row gutter={16}>
      <Col span={8}><Card><Statistic title={t('dash.progress')} value={s.progress ?? 0} suffix="%" /></Card></Col>
      <Col span={8}><Card><Statistic title={t('dash.overdue')} value={s.overdue ?? 0} /></Card></Col>
      <Col span={8}><Card><Statistic title={t('dash.completion')} value={s.completion ?? 0} suffix="%" /></Card></Col>
    </Row>
  );
}
