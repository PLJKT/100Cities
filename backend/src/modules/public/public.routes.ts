import { Router } from 'express';

const r = Router();

r.get('/project', (_req, res) => {
  const lang = (_req.query.lang as string) || _req.headers['x-lang'] || 'en';
  const copy: Record<string, { intro: string; invest: string }> = {
    en: { intro: '100Cities is a KIJA-led partnership platform for investor onboarding.', invest: 'Special economic zone incentives available for qualified partners.' },
    id: { intro: '100Cities adalah platform kemitraan yang dipimpin KIJA untuk onboarding investor.', invest: 'Insentif kawasan ekonomi khusus tersedia bagi mitra yang memenuhi syarat.' },
    zh: { intro: '百城系统是由 KIJA 主导的合作方入驻平台。', invest: '符合条件的合作方可享受经济特区优惠政策。' },
  };
  res.json(copy[lang as keyof typeof copy] || copy.en);
});

r.get('/invest', (_req, res) => {
  res.json({ items: ['Land tenure', 'Tax holiday', 'Customs facilitation'] });
});

export default r;
