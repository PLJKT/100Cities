import { Button, Card, Col, Divider, Layout, Row, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LangSwitcher from '../../components/LangSwitcher';

const { Title, Paragraph, Text } = Typography;

/**
 * 对外公开落地页（免登录）：
 * - 默认路由 /，展示 Jababeka/KIJA 100 城愿景与四大支柱
 * - 右上角语言切换 + 合作方登录按钮
 * - 登录后进入内部业务平台
 */
export default function Landing() {
  const { t } = useTranslation();
  const nav = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh', background: '#fff' }}>
      {/* Top bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 40px', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #f0f0f0',
      }}>
        <Space size={12}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: '#1677ff' }} />
          <b style={{ fontSize: 16 }}>{t('app.name')}</b>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('landing.hero.kicker')}</Text>
        </Space>
        <Space>
          <LangSwitcher />
          <Button type="primary" onClick={() => nav('/login')}>{t('landing.hero.cta')}</Button>
        </Space>
      </div>

      {/* Hero */}
      <div style={{ padding: '80px 40px 60px', background: 'linear-gradient(180deg,#f0f7ff 0%, #ffffff 100%)' }}>
        <Row justify="center">
          <Col xs={24} md={18} lg={14}>
            <Text type="secondary" style={{ letterSpacing: 2 }}>{t('landing.hero.kicker')}</Text>
            <Title level={1} style={{ marginTop: 12, fontSize: 44, lineHeight: 1.2 }}>
              {t('landing.hero.title1')}<br />
              <span style={{ color: '#1677ff' }}>{t('landing.hero.title2')}</span>
            </Title>
            <Paragraph style={{ fontSize: 18, maxWidth: 720 }}>
              {t('landing.hero.subtitle')}
            </Paragraph>
            <Space size={12} style={{ marginTop: 16 }}>
              <Button type="primary" size="large" onClick={() => nav('/login')}>
                {t('landing.hero.cta')}
              </Button>
              <Button size="large">{t('landing.hero.cta.secondary')}</Button>
            </Space>
          </Col>
        </Row>
      </div>

      {/* Stats */}
      <div style={{ padding: '40px 40px' }}>
        <Row gutter={[16, 16]} justify="center">
          {[
            { label: t('landing.stats.estates.label'), value: t('landing.stats.estates.value') },
            { label: t('landing.stats.kendal.label'), value: t('landing.stats.kendal.value') },
            { label: t('landing.stats.revenue.label'), value: t('landing.stats.revenue.value') },
            { label: t('landing.stats.edu.label'), value: t('landing.stats.edu.value') },
          ].map((s) => (
            <Col xs={12} md={6} key={s.label}>
              <Card>
                <Title level={2} style={{ margin: 0, color: '#1677ff' }}>{s.value}</Title>
                <Text type="secondary">{s.label}</Text>
              </Card>
            </Col>
          ))}
        </Row>
      </div>

      {/* Pillars */}
      <div style={{ padding: '40px' }}>
        <Row justify="center">
          <Col span={20}>
            <Title level={2} style={{ textAlign: 'center' }}>{t('landing.pillars.title')}</Title>
            <Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 32 }}>
              {t('landing.pillars.subtitle')}
            </Paragraph>
            <Row gutter={[16, 16]}>
              {[
                { k: 'infra', title: t('pillar.infra.title'), body: t('pillar.infra.body') },
                { k: 'kendal', title: t('pillar.kendal.title'), body: t('pillar.kendal.body') },
                { k: 'edu', title: t('pillar.edu.title'), body: t('pillar.edu.body') },
                { k: 'health', title: t('pillar.health.title'), body: t('pillar.health.body') },
              ].map((p) => (
                <Col xs={24} sm={12} key={p.k}>
                  <Card size="small" style={{ height: '100%' }}>
                    <Title level={5} style={{ marginTop: 0 }}>{p.title}</Title>
                    <Paragraph type="secondary" style={{ marginBottom: 0 }}>{p.body}</Paragraph>
                  </Card>
                </Col>
              ))}
            </Row>
          </Col>
        </Row>
      </div>

      {/* SEZ */}
      <div style={{ padding: '40px', background: '#fafafa' }}>
        <Row justify="center">
          <Col span={20}>
            <Title level={2} style={{ textAlign: 'center' }}>{t('landing.sez.title')}</Title>
            <Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 32 }}>
              {t('landing.sez.subtitle')}
            </Paragraph>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Card size="small" style={{ height: '100%' }}>
                  <Title level={5} style={{ marginTop: 0 }}>{t('sez.tanjung.title')}</Title>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>{t('sez.tanjung.body')}</Paragraph>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" style={{ height: '100%' }}>
                  <Title level={5} style={{ marginTop: 0 }}>{t('sez.morotai.title')}</Title>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>{t('sez.morotai.body')}</Paragraph>
                </Card>
              </Col>
            </Row>
          </Col>
        </Row>
      </div>

      {/* Vision */}
      <div style={{ padding: '60px 40px', textAlign: 'center', background: '#0b1f3a', color: '#fff' }}>
        <Title level={2} style={{ color: '#fff' }}>{t('landing.vision.title')}</Title>
        <Paragraph style={{ color: 'rgba(255,255,255,0.8)', maxWidth: 820, margin: '0 auto 24px' }}>
          {t('landing.vision.body')}
        </Paragraph>
        <Divider style={{ borderColor: 'rgba(255,255,255,0.2)' }} />
        <Title level={4} style={{ color: '#ffd666' }}>{t('landing.vision.tagline')}</Title>
        <Text style={{ color: 'rgba(255,255,255,0.75)' }}>{t('landing.vision.tagline2')}</Text>
      </div>

      {/* Footer */}
      <div style={{
        padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#061225', color: 'rgba(255,255,255,0.6)', fontSize: 12,
      }}>
        <span>{t('landing.footer.rights')}</span>
        <Button type="link" style={{ color: '#fff', padding: 0 }} onClick={() => nav('/login')}>
          {t('landing.footer.signin')} →
        </Button>
      </div>
    </Layout>
  );
}
