import { Card, Form, Input, Button, Space, Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import FileUpload from '../../components/FileUpload';
import api from '../../services/api';

/**
 * 合作方填报页：
 * - 文本字段走 /api/forms/draft 与 /api/forms/submit
 * - 附件通过 multipart 与 submit 一起提交，后端内存处理、不落盘
 * - 提交成功后记录在 DB 层锁定只读
 */
export default function FormFill() {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [msg, ctx] = message.useMessage();

  const onSubmit = async () => {
    try {
      const values = await form.validateFields();
      Modal.confirm({
        title: t('form.submit'),
        content: t('form.submit.confirm'),
        onOk: async () => {
          const fd = new FormData();
          fd.append('data', JSON.stringify(values));
          // 附件由 FileUpload 通过表单 ref 收集；这里演示接口形态
          await api.post('/forms/submit', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          msg.success('Submitted');
          form.resetFields();
        },
      });
    } catch {
      /* validation */
    }
  };

  return (
    <Card title={t('form.fill')}>
      {ctx}
      <Form form={form} layout="vertical">
        <Form.Item name="partner_name" label="Partner / Company Name">
          <Input />
        </Form.Item>
        <Form.Item name="entity_nationality" label="Entity Nationality (ID / SG / CN)">
          <Input />
        </Form.Item>
        <Form.Item name="asset_summary" label="Asset Summary">
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item name="qualifications" label="Qualifications">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item label="Attachments">
          <FileUpload />
        </Form.Item>
        <Space>
          <Button onClick={() => api.post('/forms/draft', form.getFieldsValue())}>{t('form.draft')}</Button>
          <Button type="primary" onClick={onSubmit}>{t('form.submit')}</Button>
        </Space>
      </Form>
    </Card>
  );
}
