import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

// COUNT(*) comes back from pg as a string; turn counts into numbers for the charts.
const withNumberCount = <T extends { count: string }>(rows: T[]) =>
  rows.map((row) => ({ ...row, count: Number(row.count) }));

const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

dashboardRouter.get('/stats', async (req, res) => {
  const userId = userIdOf(req);
  const [status, type, monthly, weekly, priority, followUps, activity] = await Promise.all([
    pool.query('SELECT status, COUNT(*) AS count FROM applications WHERE user_id = $1 GROUP BY status ORDER BY count DESC', [userId]),
    pool.query('SELECT type, COUNT(*) AS count FROM applications WHERE user_id = $1 GROUP BY type ORDER BY count DESC', [userId]),
    pool.query(
      `SELECT TO_CHAR(application_date, 'YYYY-MM') AS month, COUNT(*) AS count
       FROM applications WHERE user_id = $1 AND application_date >= NOW() - INTERVAL '6 months'
       GROUP BY month ORDER BY month ASC`,
      [userId],
    ),
    pool.query(
      `SELECT TO_CHAR(application_date, 'YYYY-"W"IW') AS week, COUNT(*) AS count
       FROM applications WHERE user_id = $1 AND application_date >= NOW() - INTERVAL '8 weeks'
       GROUP BY week ORDER BY week ASC`,
      [userId],
    ),
    pool.query('SELECT priority, COUNT(*) AS count FROM applications WHERE user_id = $1 GROUP BY priority', [userId]),
    pool.query(
      `SELECT id, company_name, role, follow_up_date, status FROM applications
       WHERE user_id = $1 AND follow_up_date IS NOT NULL AND follow_up_date >= CURRENT_DATE
       ORDER BY follow_up_date ASC LIMIT 5`,
      [userId],
    ),
    pool.query(
      `SELECT sh.*, a.company_name, a.role FROM status_history sh
       JOIN applications a ON sh.application_id = a.id
       WHERE a.user_id = $1 ORDER BY sh.changed_at DESC LIMIT 10`,
      [userId],
    ),
  ]);

  const statusBreakdown = withNumberCount(status.rows);
  const countOf = (...names: string[]) =>
    statusBreakdown.filter((row) => names.includes(row.status)).reduce((sum, row) => sum + row.count, 0);
  const total = statusBreakdown.reduce((sum, row) => sum + row.count, 0);

  res.json({
    total,
    statusBreakdown,
    typeBreakdown: withNumberCount(type.rows),
    monthlyApplications: withNumberCount(monthly.rows),
    weeklyApplications: withNumberCount(weekly.rows),
    responseRate: percent(countOf('interview', 'offer', 'accepted'), total),
    rejectionRate: percent(countOf('rejected'), total),
    priorityBreakdown: withNumberCount(priority.rows),
    upcomingFollowUps: followUps.rows,
    recentActivity: activity.rows,
  });
});
