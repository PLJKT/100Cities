import { Upload, Button, Alert } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

/**
 * 文件上传组件：
 * - 仅用于在前端选择文件，提交时随 /api/forms/submit 以 multipart 一起发出。
 * - 后端用 memoryStorage 内存接收 → 打包 → SMTP 转发 → 销毁，不落盘、不入 DB。
 * - 这里不上传单独接口，只做文件选择与数量/大小提示。
 */
export default function FileUpload() {
  const { t } = useTranslation();
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('form.upload')}
      />
      <Upload.Dragger multiple beforeUpload={() => false} maxCount={20}>
        <Button icon={<UploadOutlined />}>Choose files</Button>
      </Upload.Dragger>
    </>
  );
}
