import { Dropdown, Space } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import i18n from '../i18n';

const options = [
  { key: 'en', label: 'English' },
  { key: 'id', label: 'Bahasa Indonesia' },
  { key: 'zh', label: '简体中文' },
];

export default function LangSwitcher() {
  return (
    <Dropdown
      menu={{
        items: options,
        selectedKeys: [i18n.language],
        onClick: ({ key }) => i18n.changeLanguage(key),
      }}
    >
      <Space style={{ cursor: 'pointer', color: '#fff' }}>
        <GlobalOutlined /> {i18n.language.toUpperCase()}
      </Space>
    </Dropdown>
  );
}
