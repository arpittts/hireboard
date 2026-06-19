const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) return res.status(409).json({ error: 'Email already registered.' });

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);
    const colors = ['#6C5CE7', '#00B894', '#E17055', '#0984E3', '#E84393', '#00CEC9', '#FDCB6E'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, avatar_color) VALUES ($1, $2, $3, $4) RETURNING id, name, email, avatar_color, created_at',
      [name, email.toLowerCase(), passwordHash, avatarColor]
    );
    const user = result.rows[0];

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.status(201).json({ message: 'Account created successfully!', token, user: { id: user.id, name: user.name, email: user.email, avatarColor: user.avatar_color, createdAt: user.created_at } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered.' });
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const result = await pool.query('SELECT id, name, email, password_hash, avatar_color, created_at FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password.' });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ message: 'Login successful!', token, user: { id: user.id, name: user.name, email: user.email, avatarColor: user.avatar_color, createdAt: user.created_at } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, avatar_color, created_at FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const user = result.rows[0];
    res.json({ id: user.id, name: user.name, email: user.email, avatarColor: user.avatar_color, createdAt: user.created_at });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Update profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, email } = req.body;
    const updates = []; const values = []; let p = 1;
    if (name) { updates.push(`name = $${p++}`); values.push(name); }
    if (email) { updates.push(`email = $${p++}`); values.push(email.toLowerCase()); }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    values.push(req.user.id);
    const result = await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${p} RETURNING id, name, email, avatar_color`, values);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use.' });
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
