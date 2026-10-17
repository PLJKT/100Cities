import { Card, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import api from '../../services/api';

export default function PublicPortal() {
  const { t } = useTranslation();
  const [data, setData] = useState<any>({});
  useEffect(() => {
    api.get('/public/project').then((r) => setData(r.data || {})).catch(() => {});
  }, []);
  return (
    <>
      <Card title={t('portal.intro')}>
        <Typography.Paragraph>{data.intro || 'Welcome to 100Cities — KIJA partnership platform.'}</Typography.Paragraph>
      </Card>
      <Card title={t('portal.invest')} style={{ marginTop: 16 }}>
        <Typography.Paragraph>{data.invest || 'Investment information will be published here.'}</Typography.Paragraph>
      </Card>
    </>
  );
}
