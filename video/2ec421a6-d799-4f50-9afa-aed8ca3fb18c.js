import { Router } from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
const router = Router();
router.get('/', authMiddleware, async (req, res) => {
  const { since } = req.query;
  const { rows } = await pool.query(
    `SELECT m.*, u.username as uploader FROM media m LEFT JOIN users u ON m.uploaded_by = u.id ${since ? 'WHERE m.updated_at > $1' : ''} ORDER BY m.created_at DESC`,
    since ? [since] : []
  );
  const OWNER = process.env.GITHUB_OWNER;
  res.json({ syncedAt: new Date().toISOString(), newOrUpdated: rows.map(m => ({ ...m, rawUrl: `https://raw.githubusercontent.com/${OWNER}/${m.github_repo}/main/${m.github_path}` })), deleted: [] });
});
export default router;
