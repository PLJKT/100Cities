import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Table, Tag, Button, Segmented, Space, Checkbox, Select, message } from 'antd';
import { Link } from 'react-router-dom';
import api from '../../services/api';

const PRIORITY_COLOR: Record<string, string> = { urgent: 'red', high: 'orange', normal: 'default', low: 'default' };

export default function TaskList() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('open');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  // 任务标题在库里就是三语，按当前语言取，不做运行时翻译
  const titleOf = (r: any) => {
    const lang = (i18n.language || 'en').slice(0, 2);
    if (lang === 'zh') return r.title_zh || r.title;
    if (lang === 'id') return r.title_id || r.title;
    return r.title;
  };

  const load = () => {
    setLoading(true);
    const params: any = {};
    if (status !== 'all') params.status = status;
    if (overdueOnly) params.overdue = true;
    api.get('/tasks', { params })
      .then((r) => setRows(r.data?.items || []))
      .catch(() => message.error('load failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get('/admin/users').then((r) => setUsers(r.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, overdueOnly]);

  const setTaskStatus = async (id: number, next: string) => {
    try {
      await api.put(`/tasks/${id}/status`, { status: next });
      message.success(next);
      load();
    } catch {
      message.error('failed');
    }
  };

  const assign = async (id: number, userId: number) => {
    try {
      await api.put(`/tasks/${id}/assign`, { assignee_user_id: userId });
      message.success(t('tasks.assign'));
      load();
    } catch {
      message.error('failed');
    }
  };

  return (
    <Card
      title={t('tasks.title')}
      extra={<span style={{ color: '#888' }}>{t('tasks.lead')}</span>}
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={status}
          onChange={(v) => setStatus(v as string)}
          options={[
            { value: 'open', label: t('tstatus.open') },
            { value: 'done', label: t('tstatus.done') },
            { value: 'all', label: 'All' },
          ]}
        />
        <Checkbox checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)}>
          {t('tasks.overdue')}
        </Checkbox>
        <span style={{ color: '#888', fontSize: 12 }}>{rows.length} rows</span>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        columns={[
          {
            title: t('tasks.type'), dataIndex: 'task_type', width: 190,
            render: (v, r: any) => (
              <span>
                <Tag>{v}</Tag>
                {r.escalation_level > 0 ? <Tag color="red">L{r.escalation_level}</Tag> : null}
              </span>
            ),
          },
          {
            title: t('tasks.subject'),
            render: (_: any, r: any) => (
              <div>
                <div style={{ fontWeight: 500 }}>{titleOf(r)}</div>
                {r.detail ? <div style={{ color: '#888', fontSize: 12 }}>{r.detail}</div> : null}
              </div>
            ),
          },
          {
            title: t('tasks.case'), width: 170,
            render: (_: any, r: any) =>
              r.case_id ? <Link to="/app/cases">{r.case_no || `#${r.case_id}`}</Link> : '-',
          },
          {
            title: t('tasks.assignee'), width: 170,
            render: (_: any, r: any) => (
              <Select
                size="small"
                style={{ width: 150 }}
                value={r.assignee_user_id || undefined}
                placeholder={t('tasks.unassigned')}
                onChange={(v) => assign(r.id, v)}
                options={users.map((u) => ({ value: u.id, label: u.username }))}
              />
            ),
          },
          {
            title: t('tasks.priority'), dataIndex: 'priority', width: 100,
            render: (v: string) => <Tag color={PRIORITY_COLOR[v] || 'default'}>{v}</Tag>,
          },
          {
            title: t('tasks.due'), width: 170,
            render: (_: any, r: any) => (
              <span>
                {r.due_at || '-'}
                {r.is_overdue ? <Tag color="red" style={{ marginLeft: 6 }}>SLA</Tag> : null}
              </span>
            ),
          },
          {
            title: t('tasks.status'), dataIndex: 'status', width: 110,
            render: (v: string) => (
              <Tag color={v === 'open' ? 'orange' : v === 'done' ? 'green' : 'default'}>{t(`tstatus.${v}`, v)}</Tag>
            ),
          },
          {
            title: '',
            width: 120,
            render: (_: any, r: any) =>
              r.status === 'open' ? (
                <Button size="small" type="link" onClick={() => setTaskStatus(r.id, 'done')}>
                  {t('tasks.markDone')}
                </Button>
              ) : (
                <Button size="small" type="link" onClick={() => setTaskStatus(r.id, 'open')}>
                  {t('tasks.reopen')}
                </Button>
              ),
          },
        ]}
      />
    </Card>
  );
}
