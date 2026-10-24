import { Card, Col, Row, Statistic } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Column, Pie } from '@ant-design/plots';
import api from '../../services/api';

function kvToArr(obj: Record<string, number>) {
  return Object.entries(obj || {}).map(([type, value]) => ({ type, value }));
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [s, setS] = useState<any>({});
  const [detail, setDetail] = useState<any[]>([]);

  useEffect(() => {
    api.get('/dashboard/summary').then((r) => setS(r.data || {})).catch(() => {});
    // 审核管理员可见明细；BOD 调会 403，前端静默降级
    api.get('/dashboard/detail').then((r) => setDetail(r.data || [])).catch(() => setDetail([]));
  }, []);

  const statusData = kvToArr(
    detail.reduce((acc: any, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {})
  );

  const assets = s.assets || {};
  const leads = s.leads || {};
  const projects = s.projects || {};
  const partners = s.partners || {};
  const pipeline = s.pipeline || {};

  return (
    <Row gutter={[16, 16]}>
      {/* 关键指标卡 */}
      <Col xs={12} sm={8} lg={4}><Card><Statistic title={t('dash.submits')} value={s.submits?.total ?? s.total ?? 0} /></Card></Col>
      <Col xs={12} sm={8} lg={4}><Card><Statistic title={t('dash.approvedRate')} value={s.submits?.progress ?? s.progress ?? 0} suffix="%" /></Card></Col>
      <Col xs={12} sm={8} lg={4}><Card><Statistic title={t('dash.members')} value={partners.total ?? 0} /></Card></Col>
      <Col xs={12} sm={8} lg={4}><Card><Statistic title={t('dash.leads')} value={leads.total ?? 0} /></Card></Col>
      <Col xs={12} sm={8} lg={4}><Card><Statistic title={t('dash.projects')} value={projects.total ?? 0} /></Card></Col>
      <Col xs={12} sm={8} lg={4}><Card><Statistic title={t('dash.assets')} value={assets.total ?? 0} /></Card></Col>

      {/* 提交 */}
      <Col xs={24} md={12}>
        <Card title={t('dash.submitStatus')}><Pie data={statusData} angleField="value" colorField="type" radius={0.8} height={260} /></Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title={t('dash.submits')}><Column data={statusData} xField="type" yField="value" height={260} /></Card>
      </Col>

      {/* 资产 */}
      <Col xs={24} md={12}>
        <Card title={t('dash.assetCategory')}><Column data={kvToArr(assets.byCategory)} xField="type" yField="value" height={260} /></Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title={t('dash.assetStatus')}><Pie data={kvToArr(assets.byStatus)} angleField="value" colorField="type" radius={0.8} height={260} /></Card>
      </Col>

      {/* 潜客 / 审核流 */}
      <Col xs={24} md={12}>
        <Card title={t('dash.leadStatus')}><Pie data={kvToArr(leads.byStatus)} angleField="value" colorField="type" radius={0.8} height={260} /></Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title={t('dash.pipelineStage')}>
          <Column data={kvToArr(pipeline.byStage)} xField="type" yField="value" height={260} />
          <div style={{ textAlign: 'center', color: '#8c8c8c', marginTop: 4 }}>
            {t('dash.pipelineEvents')}: {pipeline.totalEvents ?? 0}
          </div>
        </Card>
      </Col>

      {/* 项目 / 会员 */}
      <Col xs={24} md={12}>
        <Card title={t('dash.projectStage')}><Column data={kvToArr(projects.byStage)} xField="type" yField="value" height={260} /></Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title={t('dash.memberTier')}><Pie data={kvToArr(partners.byTier)} angleField="value" colorField="type" radius={0.8} height={260} /></Card>
      </Col>
    </Row>
  );
}
