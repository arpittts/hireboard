const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// GET all applications
router.get('/', async (req, res) => {
  try {
    const { status, type, priority, search, sort = 'updated_at', order = 'desc' } = req.query;
    let query = 'SELECT * FROM applications WHERE user_id = $1';
    const values = [req.user.id];
    let p = 2;
    if (status) { query += ` AND status = $${p++}`; values.push(status); }
    if (type) { query += ` AND type = $${p++}`; values.push(type); }
    if (priority) { query += ` AND priority = $${p++}`; values.push(priority); }
    if (search) { query += ` AND (company_name ILIKE $${p} OR role ILIKE $${p})`; values.push(`%${search}%`); p++; }
    const allowedSorts = ['created_at', 'updated_at', 'application_date', 'company_name', 'deadline', 'priority'];
    query += ` ORDER BY ${allowedSorts.includes(sort) ? sort : 'updated_at'} ${order === 'asc' ? 'ASC' : 'DESC'}`;
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) { console.error('Get applications error:', err); res.status(500).json({ error: 'Server error.' }); }
});

// GET single application
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM applications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
    const history = await pool.query('SELECT * FROM status_history WHERE application_id = $1 ORDER BY changed_at DESC', [req.params.id]);
    res.json({ ...result.rows[0], statusHistory: history.rows });
  } catch (err) { console.error('Get application error:', err); res.status(500).json({ error: 'Server error.' }); }
});

// CREATE application
router.post('/', async (req, res) => {
  try {
    const { company_name, role, type = 'job', status = 'applied', application_date, deadline, url, location, salary, notes, contact_name, contact_email, contact_phone, contact_linkedin, follow_up_date, priority = 'medium' } = req.body;
    if (!company_name || !role) return res.status(400).json({ error: 'Company name and role are required.' });

    const result = await pool.query(
      `INSERT INTO applications (user_id, company_name, role, type, status, application_date, deadline, url, location, salary, notes, contact_name, contact_email, contact_phone, contact_linkedin, follow_up_date, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [req.user.id, company_name, role, type, status, application_date || new Date(), deadline||null, url||null, location||null, salary||null, notes||null, contact_name||null, contact_email||null, contact_phone||null, contact_linkedin||null, follow_up_date||null, priority]
    );
    const app = result.rows[0];
    await pool.query('INSERT INTO status_history (application_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)', [app.id, null, status, 'Application created']);
    res.status(201).json(app);
  } catch (err) { console.error('Create application error:', err); res.status(500).json({ error: 'Server error.' }); }
});

// UPDATE application
router.put('/:id', async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM applications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
    const old = existing.rows[0];
    const { company_name, role, type, status, application_date, deadline, url, location, salary, notes, contact_name, contact_email, contact_phone, contact_linkedin, follow_up_date, priority } = req.body;

    const result = await pool.query(
      `UPDATE applications SET company_name=$1, role=$2, type=$3, status=$4, application_date=$5, deadline=$6, url=$7, location=$8, salary=$9, notes=$10, contact_name=$11, contact_email=$12, contact_phone=$13, contact_linkedin=$14, follow_up_date=$15, priority=$16
       WHERE id=$17 AND user_id=$18 RETURNING *`,
      [company_name||old.company_name, role||old.role, type||old.type, status||old.status, application_date||old.application_date,
       deadline!==undefined?deadline:old.deadline, url!==undefined?url:old.url, location!==undefined?location:old.location,
       salary!==undefined?salary:old.salary, notes!==undefined?notes:old.notes, contact_name!==undefined?contact_name:old.contact_name,
       contact_email!==undefined?contact_email:old.contact_email, contact_phone!==undefined?contact_phone:old.contact_phone,
       contact_linkedin!==undefined?contact_linkedin:old.contact_linkedin, follow_up_date!==undefined?follow_up_date:old.follow_up_date,
       priority||old.priority, req.params.id, req.user.id]
    );

    if (status && status !== old.status) {
      await pool.query('INSERT INTO status_history (application_id, from_status, to_status, note) VALUES ($1,$2,$3,$4)',
        [req.params.id, old.status, status, req.body.status_note || `Status changed from ${old.status} to ${status}`]);
    }
    res.json(result.rows[0]);
  } catch (err) { console.error('Update application error:', err); res.status(500).json({ error: 'Server error.' }); }
});

// DELETE application
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM applications WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
    res.json({ message: 'Application deleted successfully.' });
  } catch (err) { console.error('Delete application error:', err); res.status(500).json({ error: 'Server error.' }); }
});

// PATCH status (kanban drag & drop)
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required.' });
    const existing = await pool.query('SELECT status FROM applications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
    const oldStatus = existing.rows[0].status;
    if (oldStatus === status) return res.json({ message: 'Status unchanged.' });

    const result = await pool.query('UPDATE applications SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *', [status, req.params.id, req.user.id]);
    await pool.query('INSERT INTO status_history (application_id, from_status, to_status, note) VALUES ($1,$2,$3,$4)',
      [req.params.id, oldStatus, status, note || `Status changed from ${oldStatus} to ${status}`]);
    res.json(result.rows[0]);
  } catch (err) { console.error('Update status error:', err); res.status(500).json({ error: 'Server error.' }); }
});

// GET status history
router.get('/:id/history', async (req, res) => {
  try {
    const app = await pool.query('SELECT id FROM applications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (app.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
    const history = await pool.query('SELECT * FROM status_history WHERE application_id = $1 ORDER BY changed_at DESC', [req.params.id]);
    res.json(history.rows);
  } catch (err) { console.error('Get history error:', err); res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
