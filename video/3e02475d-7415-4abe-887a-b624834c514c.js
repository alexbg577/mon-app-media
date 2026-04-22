import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { authMiddleware, ownerMiddleware } from '../middleware/auth.js';
const router = Router();

// Setup owner (public, une fois)
router.post('/setup-owner', async (req, res) => {
  const existing = await pool.query("SELECT id FROM users WHERE role = 'owner'");
  if (existing.rows.length) return res.status(400).json({ error: 'Owner existe déjà' });
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.status(400).json({ error: 'Champs requis' });
  const passwordHash = await bcrypt.hash(password, 12);
  const id = uuidv4();
  await pool.query("INSERT INTO users (id, email, username, password_hash, role) VALUES ($1,$2,$3,$4,'owner')", [id, email, username, passwordHash]);
  res.json({ success: true, message: 'Owner créé ✅' });
});

router.use(authMiddleware, ownerMiddleware);

// Générer des codes
router.post('/invite', async (req, res) => {
  const { count = 1 } = req.body;
  const codes = [];
  for (let i = 0; i < Math.min(count, 20); i++) {
    const code = uuidv4().split('-')[0].toUpperCase();
    await pool.query('INSERT INTO invite_codes (id, code) VALUES ($1,$2)', [uuidv4(), code]);
    codes.push(code);
  }
  res.json({ codes });
});

// Liste codes
router.get('/invites', async (req, res) => {
  const { rows } = await pool.query(`SELECT ic.*, u.username as used_by_username FROM invite_codes ic LEFT JOIN users u ON ic.used_by = u.id ORDER BY ic.created_at DESC`);
  res.json(rows);
});

// Supprimer un code
router.delete('/invite/:code', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM invite_codes WHERE code = $1', [req.params.code]);
  if (!rows.length) return res.status(404).json({ error: 'Code introuvable' });
  if (rows[0].used) return res.status(400).json({ error: 'Code déjà utilisé' });
  await pool.query('DELETE FROM invite_codes WHERE code = $1', [req.params.code]);
  res.json({ success: true });
});

// Liste users
router.get('/users', async (req, res) => {
  const { rows } = await pool.query('SELECT id, email, username, role, created_at FROM users ORDER BY created_at DESC');
  res.json(rows);
});

// Changer MDP d'un user (owner)
router.post('/change-password', async (req, res) => {
  const { userId, newPassword } = req.body;
  if (!userId || !newPassword) return res.status(400).json({ error: 'Champs requis' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Min 8 caractères' });
  const newHash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
  res.json({ success: true });
});

// Supprimer un user
router.delete('/user/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (rows[0].role === 'owner') return res.status(400).json({ error: 'Impossible de supprimer le owner' });
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
