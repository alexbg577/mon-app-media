import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
const router = Router();

router.post('/register', async (req, res) => {
  const { email, username, password, inviteCode } = req.body;
  if (!email || !username || !password || !inviteCode) return res.status(400).json({ error: 'Tous les champs requis' });
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe min. 8 caractères' });
  const client = await pool.connect();
  try {
    const code = await client.query('SELECT * FROM invite_codes WHERE code = $1 AND used = FALSE', [inviteCode]);
    if (!code.rows.length) return res.status(400).json({ error: 'Code invalide ou déjà utilisé' });
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    await client.query('INSERT INTO users (id, email, username, password_hash) VALUES ($1,$2,$3,$4)', [userId, email.toLowerCase(), username, passwordHash]);
    await client.query('UPDATE invite_codes SET used = TRUE, used_by = $1 WHERE code = $2', [userId, inviteCode]);
    const token = jwt.sign({ id: userId, username, email, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: userId, username, email, role: 'user' } });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email ou pseudo déjà pris' });
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Identifiants requis' });
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username.toLowerCase()]);
    if (!result.rows.length) return res.status(401).json({ error: 'Identifiants incorrects' });
    const user = result.rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Identifiants incorrects' });
    const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } finally { client.release(); }
});

router.get('/me', authMiddleware, (req, res) => res.json({ user: req.user }));

// Mot de passe oublié - envoie un vrai email
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis' });
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    // Toujours répondre success pour ne pas révéler si l'email existe
    if (!result.rows.length) return res.json({ success: true });

    const user = result.rows[0];
    const resetToken = uuidv4();
    const expiry = new Date(Date.now() + 3600000); // 1h

    // Créer table si besoin
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT FALSE
      )
    `);
    // Supprimer les anciens tokens de cet user
    await client.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    await client.query('INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1,$2,$3)', [user.id, resetToken, expiry]);

    // Envoyer l'email avec nodemailer si configuré
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.default.createTransport({
          service: 'gmail',
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });
        await transporter.sendMail({
          from: `"Chev Comu" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: '🔑 Réinitialisation de ton mot de passe — Chev Comu',
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
              <h2 style="color:#ff6b35">◈ Chev Comu</h2>
              <h3>Réinitialisation de mot de passe</h3>
              <p>Bonjour <strong>${user.username}</strong>,</p>
              <p>Tu as demandé à réinitialiser ton mot de passe. Voici ton code de réinitialisation :</p>
              <div style="background:#f5f2ed;border-radius:12px;padding:20px;text-align:center;margin:24px 0">
                <span style="font-size:24px;font-weight:800;letter-spacing:4px;color:#ff6b35">${resetToken.split('-')[0].toUpperCase()}</span>
              </div>
              <p style="color:#888;font-size:13px">Ce code expire dans 1 heure.</p>
              <p style="color:#888;font-size:13px">Si tu n'as pas fait cette demande, ignore cet email.</p>
            </div>
          `
        });
      } catch (emailErr) {
        console.error('Erreur email:', emailErr.message);
      }
    } else {
      console.log(`[DEV] Reset token for ${email}: ${resetToken}`);
    }

    res.json({ success: true });
  } finally { client.release(); }
});

// Changer son propre mot de passe
router.post('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Champs requis' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Min 8 caractères' });
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (!await bcrypt.compare(currentPassword, result.rows[0].password_hash)) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    const newHash = await bcrypt.hash(newPassword, 12);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
    res.json({ success: true });
  } finally { client.release(); }
});

export default router;
