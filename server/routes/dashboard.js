const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    const totalResult = await pool.query('SELECT COUNT(*) as total FROM applications WHERE user_id = $1', [userId]);
    const statusResult = await pool.query('SELECT status, COUNT(*) as count FROM applications WHERE user_id = $1 GROUP BY status ORDER BY count DESC', [userId]);
    const typeResult = await pool.query('SELECT type, COUNT(*) as count FROM applications WHERE user_id = $1 GROUP BY type ORDER BY count DESC', [userId]);

    const monthlyResult = await pool.query(
      `SELECT TO_CHAR(application_date, 'YYYY-MM') as month, COUNT(*) as count
       FROM applications WHERE user_id = $1 AND application_date >= NOW() - INTERVAL '6 months'
       GROUP BY month ORDER BY month ASC`, [userId]);

    const responseResult = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('interview','offer','accepted')) as responses, COUNT(*) as total
       FROM applications WHERE user_id = $1`, [userId]);

    const priorityResult = await pool.query('SELECT priority, COUNT(*) as count FROM applications WHERE user_id = $1 GROUP BY priority', [userId]);

    const followUpsResult = await pool.query(
      `SELECT id, company_name, role, follow_up_date, status FROM applications
       WHERE user_id = $1 AND follow_up_date IS NOT NULL AND follow_up_date >= CURRENT_DATE
       ORDER BY follow_up_date ASC LIMIT 5`, [userId]);

    const activityResult = await pool.query(
      `SELECT sh.*, a.company_name, a.role FROM status_history sh
       JOIN applications a ON sh.application_id = a.id
       WHERE a.user_id = $1 ORDER BY sh.changed_at DESC LIMIT 10`, [userId]);

    const weeklyResult = await pool.query(
      `SELECT TO_CHAR(application_date, 'YYYY-"W"IW') as week, COUNT(*) as count
       FROM applications WHERE user_id = $1 AND application_date >= NOW() - INTERVAL '8 weeks'
       GROUP BY week ORDER BY week ASC`, [userId]);

    const total = parseInt(totalResult.rows[0].total);
    const responses = parseInt(responseResult.rows[0].responses || 0);
    const responseRate = total > 0 ? ((responses / total) * 100).toFixed(1) : 0;
    const rejections = statusResult.rows.find(s => s.status === 'rejected');
    const rejectionCount = rejections ? parseInt(rejections.count) : 0;
    const rejectionRate = total > 0 ? ((rejectionCount / total) * 100).toFixed(1) : 0;

    res.json({
      total,
      statusBreakdown: statusResult.rows.map(r => ({ ...r, count: parseInt(r.count) })),
      typeBreakdown: typeResult.rows.map(r => ({ ...r, count: parseInt(r.count) })),
      monthlyApplications: monthlyResult.rows.map(r => ({ ...r, count: parseInt(r.count) })),
      weeklyApplications: weeklyResult.rows.map(r => ({ ...r, count: parseInt(r.count) })),
      responseRate: parseFloat(responseRate),
      rejectionRate: parseFloat(rejectionRate),
      priorityBreakdown: priorityResult.rows.map(r => ({ ...r, count: parseInt(r.count) })),
      upcomingFollowUps: followUpsResult.rows,
      recentActivity: activityResult.rows,
    });
  } catch (err) { console.error('Dashboard stats error:', err); res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
