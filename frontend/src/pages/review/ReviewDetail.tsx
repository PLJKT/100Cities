import { Card, Descriptions, Input, Button, Space, message } from 'antd';
import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';

export default function ReviewDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [remark, setRemark] = useState('');
  const [msg, ctx] = message.useMessage();

  const approve = async () => {
    await api.post(`/review/${id}/approve`);
    msg.success('Approved');
  };
  const reject = async () => {
    await api.post(`/review/${id}/reject`, { remark });
    msg.success('Rejected');
  };
  const remind = async () => {
    await api.post(`/review/${id}/remind`);
    msg.success('Reminder sent');
  };

  return (
    <Card title={`Review #${id}`}>
      {ctx}
      <Descriptions bordered column={1}>
        <Descriptions.Item label="Doc No.">{id}-DEMO</Descriptions.Item>
        <Descriptions.Item label="Partner">Demo Partner</Descriptions.Item>
        <Descriptions.Item label="Status">pending</Descriptions.Item>
      </Descriptions>
      <div style={{ marginTop: 16 }}>
        <Input.TextArea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={t('review.remark')} />
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" onClick={approve}>{t('review.approve')}</Button>
          <Button danger onClick={reject}>{t('review.reject')}</Button>
          <Button onClick={remind}>{t('review.remind')}</Button>
        </Space>
      </div>
    </Card>
  );
}
