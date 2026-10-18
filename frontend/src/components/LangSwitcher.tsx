import { Dropdown, Button } from 'antd';
import { GlobalOutlined, DownOutlined, CheckOutlined } from '@ant-design/icons';
import i18n from '../i18n';

const options = [
  { key: 'en', label: 'English' },
  { key: 'id', label: 'Bahasa Indonesia' },
  { key: 'zh', label: '简体中文' },
];

export default function LangSwitcher() {
  const current = options.find((o) => o.key === i18n.language) || options[0];
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectedKeys: [i18n.language],
        items: options.map((o) => ({
          key: o.key,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: o.key === i18n.language ? 700 : 400 }}>
              {o.key === i18n.language && <CheckOutlined style={{ color: '#0f4d3a' }} />}
              <span>{o.label}</span>
            </span>
          ),
        })),
        onClick: ({ key }) => i18n.changeLanguage(key),
      }}
    >
      <Button
        icon={<GlobalOutlined />}
        style={{
          background: '#0f4d3a',
          color: '#fff',
          borderColor: '#d4af37',
          fontWeight: 600,
        }}
        size="middle"
      >
        {current.label} <DownOutlined style={{ fontSize: 10 }} />
      </Button>
    </Dropdown>
  );
}
