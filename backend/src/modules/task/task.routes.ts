import { Router } from 'express';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';
import { assignTask, getTask, listTasks, updateTaskStatus } from '../automation/task.service';

/** 任务中心 API —— 待办是持久化实体，Dashboard 与列表读的是同一份数据 */
const r = Router();

r.get('/', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const { status, case_id, task_type, overdue, mine, limit, offset } = req.query as any;
  res.json(
    listTasks({
      status: status || (overdue ? undefined : 'open'),
      caseId: case_id ? Number(case_id) : undefined,
      taskType: task_type || undefined,
      overdue: !!overdue,
      assignee: mine ? req.user!.uid : undefined,
      limit,
      offset,
    })
  );
});

r.get('/:id', authRequired, requirePerm('review'), (req, res) => {
  const t = getTask(Number(req.params.id));
  if (!t) return res.status(404).json({ error: { message: 'Task not found' } });
  res.json(t);
});

r.put('/:id/status', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  try {
    const { status, note } = req.body || {};
    const out = updateTaskStatus(Number(req.params.id), status, { type: 'user', userId: req.user!.uid }, note);
    writeLog(req.user!.uid, 'task.status', 'task', Number(req.params.id), { status });
    res.json({ ok: true, task: out });
  } catch (e) {
    next(e);
  }
});

r.put('/:id/assign', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  try {
    const userId = (req.body || {}).assignee_user_id ?? null;
    const out = assignTask(Number(req.params.id), userId == null ? null : Number(userId), { type: 'user', userId: req.user!.uid });
    res.json({ ok: true, task: out });
  } catch (e) {
    next(e);
  }
});

export default r;
