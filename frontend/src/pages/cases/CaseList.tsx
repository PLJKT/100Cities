import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, Table, Tag, Button, Drawer, Descriptions, Tabs, Timeline, Space, Modal, Select, Input, message, Empty, Alert,
} from 'antd';
import api from '../../services/api';

const LIFE_COLOR: Record<string, string> = {
  inquiry: 'default', qualified: 'blue', active: 'geekblue', won: 'green', lost: 'red', dropped: 'default',
};
const TASK_STATUS_COLOR: Record<string, string> = { open: 'orange', done: 'green', cancelled: 'default' };

export default function CaseList() {
  const { t } = useTranslation();
  // 有词条用译文，没有就退回库里的原值（避免出现裸 key）
  const tv = (key: string, fb?: string) => {
    const s = t(key);
    return s === key && fb ? fb : String(s);
  };
  const [data, setData] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [stageTo, setStageTo] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/cases')
      .then((r) => setData(r.data || { items: [], total: 0 }))
      .catch(() => message.error('load failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get('/assets').then((r) => setAssets(r.data || [])).catch(() => {});
  }, []);

  // 360 视图 = 案件本体 + 统一时间线 + 联动溯源，三个接口并行取，抽屉里一次讲完整故事
  const fetchCase = async (id: number) => {
    const [base, tl, ex] = await Promise.all([
      api.get(`/cases/${id}`),
      api.get(`/cases/${id}/timeline`).catch(() => ({ data: [] })),
      api.get(`/cases/${id}/explain`).catch(() => ({ data: { runs: [] } })),
    ]);
    const runs = (ex.data?.runs || []);
    return {
      ...(base.data || {}),
      timeline: tl.data || [],
      explain: runs.map((x: any) => ({ ...x, detail: x.detail || '' })),
    };
  };

  const openCase = async (id: number) => {
    setDetail(null);
    setOpen(true);
    try {
      setDetail(await fetchCase(id));
    } catch {
      message.error('case not found');
    }
  };

  const refresh = async () => {
    if (detail?.case?.id) {
      setDetail(await fetchCase(detail.case.id));
    }
    load();
  };

  const advance = async (force = false) => {
    if (!stageTo) return message.warning('pick a stage');
    setBusy(true);
    try {
      await api.post(`/cases/${detail.case.id}/stage`, { stage: stageTo, note, force });
      message.success(`${t('cases.advance')}: ${stageTo}`);
      setNote('');
      setStageTo('');
      await refresh();
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || 'failed';
      if (e?.response?.status === 409 && !force) {
        Modal.confirm({
          title: 'Backward / duplicate stage',
          content: msg,
          okText: 'Force',
          onOk: () => advance(true),
        });
      } else {
        message.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const win = () =>
    Modal.confirm({
      title: t('cases.won'),
      content: t('cases.confirmWon'),
      onOk: async () => {
        await api.post(`/cases/${detail.case.id}/won`, { note });
        message.success('won');
        await refresh();
      },
    });

  const lose = () =>
    Modal.confirm({
      title: t('cases.lost'),
      content: t('cases.confirmLost'),
      onOk: async () => {
        await api.post(`/cases/${detail.case.id}/lost`, { reason: note || 'not specified' });
        message.success('lost');
        await refresh();
      },
    });

  const linkAsset = async (assetId: number) => {
    try {
      await api.put(`/cases/${detail.case.id}/asset`, { asset_id: assetId });
      message.success('asset linked');
      await refresh();
    } catch (e: any) {
      message.error(e?.response?.data?.error?.message || 'conflict');
    }
  };

  return (
    <Card title={t('cases.title')} extra={<span style={{ color: '#888' }}>{t('cases.lead')}</span>}>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        pagination={{ pageSize: 20, total: data.total, showSizeChanger: false }}
        onRow={(r) => ({ onClick: () => openCase(r.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: t('cases.no'), dataIndex: 'case_no', width: 140 },
          { title: t('cases.org'), dataIndex: 'org_name' },
          { title: t('cases.country'), dataIndex: 'country', width: 90 },
          {
            title: t('cases.lifecycle'), dataIndex: 'lifecycle', width: 120,
            render: (v) => <Tag color={LIFE_COLOR[v] || 'default'}>{tv(`lifecycle.${v}`, v)}</Tag>,
          },
          {
            title: t('cases.stage'), dataIndex: 'stage', width: 120,
            render: (v, r: any) => (
              <span>
                <Tag>{tv(`stage.${v}`, v)}</Tag>
                {r.stage_entered_at ? <span style={{ color: '#999', fontSize: 12 }}>{r.stage_age_days ?? ''}d</span> : null}
              </span>
            ),
          },
          {
            title: t('cases.tasks'), width: 110,
            render: (_: any, r: any) => (
              <Space size={4}>
                <Tag color="orange">{r.open_tasks ?? 0}</Tag>
                {r.overdue_tasks ? <Tag color="red">{r.overdue_tasks}</Tag> : null}
              </Space>
            ),
          },
          { title: t('cases.asset'), dataIndex: 'asset_name', ellipsis: true },
        ]}
      />

      <Drawer
        title={detail?.case?.case_no || 'case'}
        width={760}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
      >
        {!detail ? (
          <Empty description="loading" />
        ) : (
          <>
            {detail.stage_sla_days && detail.stage_age_days >= detail.stage_sla_days ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={`Stage ${detail.stage} — ${detail.stage_age_days} days (SLA ${detail.stage_sla_days}d)`}
              />
            ) : null}

            <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label={t('cases.org')}>{detail.case.org_name}</Descriptions.Item>
              <Descriptions.Item label={t('cases.country')}>{detail.case.country || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('cases.lifecycle')}>
                <Tag color={LIFE_COLOR[detail.case.lifecycle]}>{tv(`lifecycle.${detail.case.lifecycle}`, detail.case.lifecycle)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('cases.stage')}>
                <Tag>{tv(`stage.${detail.stage}`, detail.stage)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('cases.asset')}>{detail.asset?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('cases.stageAge')}>
                {detail.stage_entered_at} ({detail.stage_age_days}d)
              </Descriptions.Item>
            </Descriptions>

            <Space wrap style={{ marginBottom: 12 }}>
              <Select
                style={{ width: 180 }}
                placeholder={t('cases.advance')}
                value={stageTo || undefined}
                onChange={setStageTo}
                options={['intake', 'matching', 'site_visit', 'proposal', 'decision'].map((s) => ({
                  value: s,
                  label: t(`stage.${s}`, s),
                }))}
              />
              <Input style={{ width: 220 }} placeholder={t('cases.note')} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="primary" loading={busy} onClick={() => advance(false)}>
                {t('cases.advance')}
              </Button>
              <Button onClick={win} disabled={detail.case.lifecycle === 'won'}>{t('cases.won')}</Button>
              <Button danger onClick={lose} disabled={detail.case.lifecycle === 'lost'}>{t('cases.lost')}</Button>
              <Select
                style={{ width: 220 }}
                placeholder={t('cases.link')}
                value={detail.case.asset_id || undefined}
                onChange={(v) => linkAsset(v)}
                options={assets.map((a) => ({
                  value: a.id,
                  label: `${a.name} · ${tv(`assets.st.${a.status}`, a.status)}`,
                  disabled: a.status === 'leased',
                }))}
              />
            </Space>

            <Tabs
              size="small"
              items={[
                {
                  key: 'tasks',
                  label: `${t('cases.tasks')} (${(detail.tasks || []).length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={detail.tasks || []}
                      columns={[
                        { title: t('tasks.type'), dataIndex: 'task_type', width: 170 },
                        { title: t('tasks.subject'), dataIndex: 'title' },
                        {
                          title: t('tasks.status'), dataIndex: 'status', width: 100,
                          render: (v: string) => <Tag color={TASK_STATUS_COLOR[v]}>{tv(`tstatus.${v}`, v)}</Tag>,
                        },
                        { title: t('tasks.due'), dataIndex: 'due_at', width: 150 },
                        {
                          title: t('tasks.overdue'), width: 80,
                          render: (_: any, r: any) =>
                            r.status === 'open' && r.due_at && r.due_at < new Date().toISOString().slice(0, 19).replace('T', ' ')
                              ? <Tag color="red">SLA</Tag>
                              : null,
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'timeline',
                  label: t('cases.timeline'),
                  children: (
                    <Timeline
                      items={((detail.timeline as any[]) || []).map((e) => ({
                        color: e.kind === 'event' ? 'blue' : e.kind === 'task' ? 'orange' : 'gray',
                        children: (
                          <div>
                            <div style={{ fontWeight: 600 }}>{e.title}</div>
                            <div style={{ color: '#888', fontSize: 12 }}>
                              {e.at} · {e.kind}{e.detail ? ` · ${e.detail}` : ''}
                            </div>
                          </div>
                        ),
                      }))}
                    />
                  ),
                },
                {
                  key: 'history',
                  label: t('cases.stageHistory'),
                  children: (
                    <Timeline
                      items={((detail.stage_history as any[]) || []).map((h) => ({
                        children: (
                          <div>
                            <Tag>{h.from_stage ? tv(`stage.${h.from_stage}`, h.from_stage) : '-'}</Tag>
                            →
                            <Tag color="blue">{tv(`stage.${h.to_stage}`, h.to_stage)}</Tag>
                            <span style={{ color: '#888', fontSize: 12 }}> {h.created_at}</span>
                            {h.note ? <div style={{ fontSize: 12 }}>{h.note}</div> : null}
                          </div>
                        ),
                      }))}
                    />
                  ),
                },
                {
                  key: 'holds',
                  label: `${t('cases.holds')} (${(detail.holds || []).length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={detail.holds || []}
                      columns={[
                        { title: 'Type', dataIndex: 'hold_type', width: 90 },
                        { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <Tag>{v}</Tag> },
                        { title: 'Expires', dataIndex: 'expires_at', width: 160 },
                        { title: 'Created', dataIndex: 'created_at' },
                      ]}
                    />
                  ),
                },
                {
                  key: 'explain',
                  label: t('cases.explain'),
                  children: (
                    <Timeline
                      items={((detail.explain as any[]) || []).map((x) => ({
                        children: (
                          <div>
                            <Tag color="blue">{x.rule_key}</Tag>
                            <span style={{ fontSize: 12, color: '#888' }}>{x.event_type} · {x.outcome}</span>
                            <div style={{ fontSize: 12 }}>{x.detail}</div>
                          </div>
                        ),
                      }))}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </Card>
  );
}
