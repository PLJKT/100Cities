import { Button, Card, Col, Row, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRightOutlined, CheckCircleOutlined } from '@ant-design/icons';
import LangSwitcher from '../../components/LangSwitcher';

const { Title, Paragraph, Text } = Typography;

// ---------- Club badge (circular seal with built-in wordmark & motto) ----------
function ClubLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}club-logo.jpg`}
      alt="100 Cities Club — Building a ship while sailing"
      width={size}
      height={size}
      style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }}
    />
  );
}

// ---------- Correct Indonesia archipelago silhouette ----------
// Approximate outline based on the reference map: Sumatra (NW-SE diagonal),
// Java (thin strip south), Kalimantan (big center), Sulawesi (K shape),
// Maluku cluster, Papua (east).
function IndonesiaMap({ opacity = 0.18 }: { opacity?: number }) {
  return (
    <svg
      viewBox="0 0 1000 420"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity }}
    >
      <g fill="#d4af37">
        {/* Sumatra — long NW-SE island */}
        <path d="M40 30
                 C 70 50, 95 90, 115 140
                 C 135 190, 160 240, 195 295
                 C 205 310, 200 320, 185 318
                 C 155 310, 125 260, 100 200
                 C 75 140, 55 80, 40 30 Z" />
        {/* Java — thin horizontal strip south of Sumatra */}
        <path d="M225 315
                 C 270 322, 330 328, 395 332
                 C 400 340, 395 345, 380 344
                 C 320 340, 265 335, 225 325 Z" />
        {/* Bali + Nusa Tenggara chain */}
        <ellipse cx="415" cy="345" rx="10" ry="5" />
        <ellipse cx="445" cy="350" rx="14" ry="5" />
        <ellipse cx="480" cy="355" rx="16" ry="5" />
        <ellipse cx="520" cy="360" rx="18" ry="6" />
        {/* Kalimantan — big center blob */}
        <path d="M320 110
                 C 370 95, 440 95, 490 130
                 C 520 155, 525 200, 505 240
                 C 485 275, 430 290, 380 275
                 C 340 262, 315 220, 315 170
                 C 315 140, 315 120, 320 110 Z" />
        {/* Sulawesi — K / orchid shape */}
        <path d="M555 130
                 C 580 140, 600 165, 595 190
                 C 590 210, 575 220, 580 245
                 C 585 270, 575 290, 560 285
                 C 545 280, 545 255, 550 230
                 C 555 205, 545 180, 550 155
                 C 552 140, 552 135, 555 130 Z" />
        {/* Maluku cluster */}
        <ellipse cx="640" cy="200" rx="14" ry="6" />
        <ellipse cx="675" cy="175" rx="10" ry="14" />
        <ellipse cx="700" cy="220" rx="12" ry="6" />
        <ellipse cx="720" cy="260" rx="10" ry="8" />
        {/* Papua — big east blob */}
        <path d="M760 170
                 C 820 150, 900 160, 960 200
                 C 975 230, 975 280, 950 310
                 C 920 335, 860 335, 810 315
                 C 770 295, 755 250, 755 210
                 C 755 190, 755 178, 760 170 Z" />
      </g>
    </svg>
  );
}

function Bullets({ items, color = '#0f4d3a' }: { items: string[]; color?: string }) {
  return (
    <ul style={{ paddingLeft: 18, margin: 0 }}>
      {items.map((b, i) => (
        <li key={i} style={{ marginBottom: 5, lineHeight: 1.5, fontSize: 13 }}>
          <CheckCircleOutlined style={{ color, marginRight: 8 }} />
          {b}
        </li>
      ))}
    </ul>
  );
}

function SegmentCell({ bg, color, label }: { bg: string; color: string; label: string }) {
  return (
    <div style={{
      background: bg, color, height: 64, borderRadius: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: 8,
      fontSize: 14, fontWeight: 700, lineHeight: 1.25,
    }}>
      {label}
    </div>
  );
}

export default function Landing() {
  const { t } = useTranslation();
  const nav = useNavigate();

  const trackBullets: string[] = t('landing.track.bullets', { returnObjects: true }) as string[];
  const flagBullets: string[] = t('landing.flag.bullets', { returnObjects: true }) as string[];
  const dualId: string[] = t('landing.dual.id.bullets', { returnObjects: true }) as string[];
  const dualCn: string[] = t('landing.dual.cn.bullets', { returnObjects: true }) as string[];
  const credList: { n: string; l: string }[] = t('landing.cred.list', { returnObjects: true }) as any;

  const members = [1, 2, 3, 4, 5].map((i) => ({
    title: t(`member.t${i}.t`), body: t(`member.t${i}.b`),
  }));
  const engine = [1, 2, 3, 4, 5].map((i) => ({
    n: i, title: t(`engine.${i}.t`), body: t(`engine.${i}.b`),
  }));

  return (
    <div style={{ minHeight: '100vh', background: '#fdfcf8', fontFamily: "'Inter','Helvetica Neue',Arial,sans-serif" }}>
      {/* Top bar — Jababeka style: white, clean */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 24px', background: 'rgba(255,255,255,0.97)',
        borderBottom: '1px solid #ececec',
      }}>
        <Space size={12} align="center">
          <ClubLogo size={64} />
          <span style={{
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: 1,
            color: '#1a1a1a',
            fontFamily: "'Archivo Black','Montserrat','Helvetica Neue',Arial,sans-serif",
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}>
            100 CITIES CLUB
          </span>
        </Space>
        <Space size={10}>
          <LangSwitcher />
          <Button type="primary" size="middle"
            style={{ background: '#0f4d3a', borderColor: '#0f4d3a', fontWeight: 600 }}
            onClick={() => nav('/login')}>
            {t('topbar.signin')}
          </Button>
        </Space>
      </div>

      {/* Hero — deep green, gold Indonesia map background, cream text */}
      <div style={{
        position: 'relative',
        padding: '72px 20px 64px',
        background: 'linear-gradient(135deg, #0f4d3a 0%, #0a3626 100%)',
        color: '#fff', textAlign: 'center', overflow: 'hidden',
      }}>
        {/* Gold Indonesia map — mix-blend-mode:screen drops the JPG's black background */}
        <img
          src={`${import.meta.env.BASE_URL}indonesia-map.jpg`}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', mixBlendMode: 'screen', opacity: 0.5,
          }}
        />
        {/* Dark scrim behind text for readability */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 60%, transparent 100%)',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'inline-block', marginBottom: 20, padding: '6px 18px',
            border: '1px solid #d4af37', borderRadius: 999,
            color: '#d4af37', fontSize: 13, letterSpacing: 3, fontWeight: 600,
          }}>
            {t('landing.hero.motto')}
          </div>
          <Title level={1} style={{
            color: '#fff',
            fontSize: 'clamp(34px, 6.5vw, 60px)',
            marginBottom: 24,
            fontWeight: 800,
            letterSpacing: 1.5,
            textShadow: '0 4px 24px rgba(0,0,0,0.5)',
            lineHeight: 1.1,
          }}>
            {t('app.name')}
          </Title>
          <Paragraph style={{
            color: '#fff',
            maxWidth: 760, margin: '0 auto',
            fontSize: 'clamp(15px, 1.6vw, 18px)',
            lineHeight: 1.85,
            fontWeight: 400,
            textShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}>
            {t('landing.hero.subtitle')}
          </Paragraph>
        </div>
      </div>

      {/* Credibility strip — cream background */}
      <div style={{ padding: '28px 20px', background: '#fdfcf8', borderBottom: '1px solid #ececec' }}>
        <Title level={4} style={{ textAlign: 'center', marginBottom: 10, color: '#0f4d3a', fontSize: 20 }}>
          {t('landing.cred.title')}
        </Title>
        <Paragraph type="secondary" style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto 18px', fontSize: 13, lineHeight: 1.6 }}>
          {t('landing.cred.lead')}
        </Paragraph>
        <div style={{ maxWidth: 1080, margin: '0 auto 18px', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <img
            src={`${import.meta.env.BASE_URL}jababeka-banner.png`}
            alt="Jababeka township — residences, clubhouse, power infrastructure, golf course and university campus"
            style={{ width: '100%', display: 'block' }}
          />
        </div>
        <Row gutter={[16, 16]} justify="center">
          {credList.map((c, i) => (
            <Col xs={12} sm={8} md={24 / 5} key={i}>
              <div style={{ textAlign: 'center', padding: '8px 6px' }}>
                <Title level={3} style={{ color: '#0f4d3a', margin: 0, fontSize: 26, fontWeight: 700 }}>
                  {c.n}
                </Title>
                <div style={{ fontSize: 12, color: '#6b6b6b', lineHeight: 1.5, marginTop: 6 }}>{c.l}</div>
              </div>
            </Col>
          ))}
        </Row>
      </div>

      {/* Track record — left bullets, right business-segment grid */}
      <div style={{ padding: '28px 20px' }}>
        <Title level={5} style={{ textAlign: 'center', marginBottom: 16, color: '#0f4d3a', fontSize: 18 }}>
          {t('landing.track.title')}
        </Title>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <Row gutter={[20, 20]} justify="center" align="middle">
          <Col xs={24} md={11}>
            <Card size="small" style={{ background: '#fdfcf8', border: '1px solid #ececec' }}>
              <Bullets items={trackBullets} />
            </Card>
          </Col>
          <Col xs={24} md={11}>
            <Row gutter={[8, 8]}>
              {/* Row 1 */}
              <Col span={6}><SegmentCell bg="#0f4d3a" color="#fff" label={t('segment.realestate')} /></Col>
              <Col span={6}><SegmentCell bg="#c8f0e8" color="#d4380d" label={t('segment.industrial')} /></Col>
              <Col span={6}><SegmentCell bg="#c8f0e8" color="#d4380d" label={t('segment.residential')} /></Col>
              <Col span={6}><SegmentCell bg="#c8f0e8" color="#d4380d" label={t('segment.commercial')} /></Col>
              {/* Row 2 */}
              <Col span={6}><SegmentCell bg="#e8a317" color="#fff" label={t('segment.infra')} /></Col>
              <Col span={6}><SegmentCell bg="#fbf1d9" color="#d4380d" label={t('segment.power')} /></Col>
              <Col span={6}><SegmentCell bg="#fbf1d9" color="#d4380d" label={t('segment.water')} /></Col>
              <Col span={6}><SegmentCell bg="#fbf1d9" color="#d4380d" label={t('segment.dryport')} /></Col>
            </Row>
          </Col>
        </Row>
        </div>
      </div>

      {/* Dual core */}
      <div style={{ padding: '28px 20px', background: '#fdfcf8', borderTop: '1px solid #ececec', borderBottom: '1px solid #ececec' }}>
        <Title level={5} style={{ textAlign: 'center', marginBottom: 16, color: '#0f4d3a', fontSize: 18 }}>{t('landing.dual.title')}</Title>
        <Row gutter={[16, 16]} justify="center">
          <Col xs={24} md={10}>
            <Card size="small" style={{ height: '100%', borderTop: '3px solid #0f4d3a' }}>
              <Title level={5} style={{ color: '#0f4d3a', marginTop: 0 }}>{t('landing.dual.id.title')}</Title>
              <Bullets items={dualId} />
            </Card>
          </Col>
          <Col xs={24} md={10}>
            <Card size="small" style={{ height: '100%', borderTop: '3px solid #b8860b' }}>
              <Title level={5} style={{ color: '#b8860b', marginTop: 0 }}>{t('landing.dual.cn.title')}</Title>
              <Bullets items={dualCn} color="#b8860b" />
            </Card>
          </Col>
        </Row>
      </div>

      {/* Members — one row */}
      <div style={{ padding: '24px 16px', background: '#fdfcf8', borderTop: '1px solid #ececec', borderBottom: '1px solid #ececec' }}>
        <Title level={5} style={{ textAlign: 'center', marginBottom: 14, color: '#0f4d3a', fontSize: 18 }}>
          {t('landing.members.title')}
        </Title>
        <div style={{ display: 'flex', gap: 10, maxWidth: 1080, margin: '0 auto' }}>
          {members.map((m, i) => (
            <div key={i} style={{
              flex: 1, minWidth: 0, background: '#fff', border: '1px solid #ececec',
              borderRadius: 8, padding: '12px 10px', textAlign: 'center',
            }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#0f4d3a', lineHeight: 1.3 }}>{m.title}</div>
              <div style={{ color: '#6b6b6b', fontSize: 11, lineHeight: 1.45 }}>{m.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Engine 5 steps — horizontal flow */}
      <div style={{ padding: '16px 16px 20px', background: '#0f4d3a', color: '#fff' }}>
        <Title level={4} style={{ color: '#fff', textAlign: 'center', marginBottom: 14, fontWeight: 600, fontSize: 20 }}>
          {t('landing.engine.title')}
        </Title>
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'stretch',
          gap: 6, maxWidth: 1080, margin: '0 auto',
        }}>
          {engine.map((e, i) => (
            <div key={e.n} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <div style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(212,175,55,0.35)',
                borderRadius: 8, padding: '10px 10px',
                textAlign: 'center', width: '100%',
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', background: '#d4af37',
                  color: '#0f4d3a', fontWeight: 700, lineHeight: '26px', margin: '0 auto 6px',
                  fontSize: 12,
                }}>{e.n}</div>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 3 }}>{e.title}</div>
                <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10.5, lineHeight: 1.4 }}>{e.body}</div>
              </div>
              {i < engine.length - 1 && (
                <div style={{ color: '#d4af37', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>→</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Vision */}
      <div style={{ padding: '32px 20px', textAlign: 'center' }}>
        <Title level={5} style={{ maxWidth: 680, margin: '0 auto 10px', color: '#0f4d3a', fontSize: 17 }}>
          {t('landing.vision.title')}
        </Title>
        <Text style={{ color: '#0f4d3a', fontWeight: 600, fontStyle: 'italic' }}>{t('landing.vision.tagline')}</Text>
        <div style={{ marginTop: 16 }}>
          <Button type="primary" size="large"
            style={{ background: '#0f4d3a', borderColor: '#0f4d3a', fontWeight: 600 }}
            onClick={() => nav('/login')}>
            {t('footer.signin')} <ArrowRightOutlined />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '18px 24px', textAlign: 'center',
        background: '#0a3626', color: 'rgba(255,255,255,0.55)', fontSize: 11, lineHeight: 1.7,
      }}>
        {t('footer.disclaimer')}
      </div>
    </div>
  );
}
