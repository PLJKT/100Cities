import { Card, Typography } from 'antd';

export default function TemplateEditor() {
  return (
    <Card title="Form Template Editor">
      <Typography.Paragraph>
        Admin can visually add/remove fields and update section config. The current version stores
        <code> section_config </code>as JSON in <code>form_template</code>. Partners always fetch the
        latest published version via <code>GET /api/forms/:templateKey</code>.
      </Typography.Paragraph>
    </Card>
  );
}
