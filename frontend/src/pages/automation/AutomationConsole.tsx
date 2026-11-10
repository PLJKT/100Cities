import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Table, Tag, Tabs, Switch, Button, Space, message, Tooltip, Badge } from 'antd';
import api from '../../services/api';

const OUTCOME_COLOR: Record<string, string> = { applied: 'green', skipped: 'default', error: 'red' };
const EVENT_COLOR: Record<string, string> = { pending: 'orange', processed: 'green', failed: 'red' };

/**
 * 自动化台：看的不是"配置"，而是"系统自己做了什么、为什么"。
 * 三栏：规则目录（可启停）/ 事件流（业务事实）/ 执行台账（决策记录）。
 */
export default function AutomationConsole() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('rules');
  const [rules, setRules] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const loadRules = () => api.get('/automation/rules').then((r) => setRules(r.data || [])).catch(() => {});
  const loadEvents = () => api.get('/automation/events').then((r) => setEvents(r.data || [])).catch(() => {});
  const loadRuns = () => api.get('/automation/runs').then((r) => setRuns(r.data || [])).catch(() => {});

  useEffect(() => {
    loadRules();
    loadEvents();
    loadRuns();
  }, []);

  const toggle = async (key: string, enabled: boolean) => {
    try {
      await api.put(`/automation/rules/${key}`, { enabled });
      message.success(`${key} → ${enabled ? 'on' : 'off'}`);
      loadRules();
    } catch {
      message.error('Super Admin only');
    }
  };

  const replay = async (id: number) => {
    setBusy(true);
    try {
      const r = await api.post(`/automation/replay/${id}`);
      message.success(`replayed: ${JSON.stringify(r.data?.processed ?? 0)} events`);
      loadEvents();
      loadRuns();
    } catch {
      message.error('replay failed (Super Admin only)');
    } finally {
      setBusy(false);
    }
  };

  const sweep = async () => {
    setBusy(true);
    try {
      const r = await api.post('/automation/sweep');
      message.success(`sweep: tasks=${r.data?.tasks?.escalated ?? 0} sla=${r.data?.stages?.breached ?? 0} holds=${r.data?.holds?.released ?? 0}`);
      loadEvents();
      loadRuns();
    } catch {
      message.error('sweep failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={t('auto.title')}
      extra={
        <Space>
          <span style={{ color: '#888' }}>{t('auto.lead')}</span>
          <Button size="small" loading={busy} onClick={sweep}>{t('auto.sweep')}</Button>
        </Space>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'rules',
            label: `${t('auto.rules')} (${rules.length})`,
            children: (
              <Table
                rowKey="rule_key"
                size="small"
                dataSource={rules}
                pagination={false}
                expandable={{
                  expandedRowRender: (r: any) => (
                    <div style={{ fontSize: 12 }}>
                      <div style={{ marginBottom: 6 }}>{r.description}</div>
                      <div><b>event:</b> <Tag>{r.event_type}</Tag></div>
                      <div><b>condition:</b> <code>{JSON.stringify(r.condition)}</code></div>
                      <div style={{ marginTop: 6 }}>
                        <b>actions:</b>
                        <ul style={{ margin: '4px 0 0 16px' }}>
                          {(r.actions || []).map((a: any, i: number) => (
                            <li key={i}><Tag>{a.type}</Tag><code>{JSON.stringify(a.params || {})}</code></li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ),
                }}
                columns={[
                  { title: t('auto.rule'), dataIndex: 'rule_key', width: 240, render: (v, r: any) => <span><b>{v}</b><div style={{ color: '#888', fontSize: 12 }}>{r.name}</div></span> },
                  { title: t('auto.trigger'), dataIndex: 'event_type', width: 190, render: (v) => <Tag>{v}</Tag> },
                  {
                    title: t('auto.applied'), width: 200,
                    render: (_: any, r: any) => (
                      <Space size={4}>
                        <Badge color="green" text={`${r.stats?.applied || 0}`} />
                        <Badge color="#999" text={`${r.stats?.skipped || 0}`} />
                        {(r.stats?.error || 0) > 0 ? <Badge color="red" text={`${r.stats.error}`} /> : null}
                      </Space>
                    ),
                  },
                  {
                    title: t('auto.enabled'), dataIndex: 'enabled', width: 100,
                    render: (v, r: any) => <Switch size="small" checked={!!v} onChange={(c) => toggle(r.rule_key, c)} />,
                  },
                ]}
              />
            ),
          },
          {
            key: 'events',
            label: `${t('auto.events')} (${events.length})`,
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={events}
                pagination={{ pageSize: 15 }}
                expandable={{
                  expandedRowRender: (r: any) => (
                    <code style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.payload, null, 2)}</code>
                  ),
                }}
                columns={[
                  { title: '#', dataIndex: 'id', width: 70 },
                  { title: t('auto.eventType'), dataIndex: 'event_type', width: 210, render: (v) => <Tag color="blue">{v}</Tag> },
                  { title: 'Entity', width: 190, render: (_: any, r: any) => `${r.entity_type}#${r.entity_id ?? '-'}${r.case_id ? ` · case ${r.case_id}` : ''}` },
                  {
                    title: t('auto.outcome'), dataIndex: 'status', width: 110,
                    render: (v) => <Tag color={EVENT_COLOR[v] || 'default'}>{v}</Tag>,
                  },
                  { title: t('auto.time'), dataIndex: 'occurred_at', width: 170 },
                  {
                    title: '',
                    width: 100,
                    render: (_: any, r: any) => (
                      <Tooltip title={t('auto.replay')}>
                        <Button size="small" type="link" loading={busy} onClick={() => replay(r.id)}>{t('auto.replay')}</Button>
                      </Tooltip>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'runs',
            label: `${t('auto.runs')} (${runs.length})`,
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={runs}
                pagination={{ pageSize: 15 }}
                columns={[
                  { title: '#', dataIndex: 'id', width: 70 },
                  { title: t('auto.rule'), dataIndex: 'rule_key', width: 230, render: (v, r: any) => <span><Tag>{v}</Tag><div style={{ color: '#888', fontSize: 12 }}>{r.rule_name}</div></span> },
                  { title: t('auto.eventType'), dataIndex: 'event_type', width: 190, render: (v) => <Tag color="blue">{v}</Tag> },
                  {
                    title: t('auto.outcome'), dataIndex: 'outcome', width: 110,
                    render: (v) => <Tag color={OUTCOME_COLOR[v] || 'default'}>{v}</Tag>,
                  },
                  { title: t('auto.detail'), dataIndex: 'detail', ellipsis: true },
                  { title: t('auto.time'), dataIndex: 'created_at', width: 170 },
                ]}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
