import { Router } from 'express';
import multer from 'multer';
import unzipper from 'unzipper';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploadFileToGithub, deleteFileFromGithub } from '../services/github.js';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/upload', authMiddleware, upload.array('files', 50), async (req, res) => {
  const { category, titles } = req.body;
  let titlesMap = {};
  try { titlesMap = JSON.parse(titles || '{}'); } catch {}
  if (!category) return res.status(400).json({ error: 'Catégorie requise' });
  if (!req.files?.length) return res.status(400).json({ error: 'Aucun fichier' });
  const results = [], errors = [];
  for (const file of req.files) {
    try {
      const ext = path.extname(file.originalname);
      const uniqueName = `${uuidv4()}${ext}`;
      const { path: githubPath, rawUrl, repo } = await uploadFileToGithub(file.buffer, uniqueName, category);
      const title = titlesMap[file.originalname] || path.basename(file.originalname, ext);
      const { rows } = await pool.query(
        `INSERT INTO media (id,title,description,category,filename,github_path,github_repo,file_size,mime_type,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [uuidv4(), title, req.body.description || null, category, file.originalname, githubPath, repo, file.size, file.mimetype, req.user.id]
      );
      results.push({ ...rows[0], rawUrl });
    } catch (err) { errors.push({ file: file.originalname, error: err.message }); }
  }
  res.json({ success: results, errors });
});

router.post('/upload-zip', authMiddleware, upload.single('zip'), async (req, res) => {
  const { category } = req.body;
  if (!category) return res.status(400).json({ error: 'Catégorie requise' });
  if (!req.file) return res.status(400).json({ error: 'Aucun ZIP' });
  const results = [], errors = [];
  try {
    const directory = await unzipper.Open.buffer(req.file.buffer);
    for (const entry of directory.files) {
      if (entry.type === 'Directory') continue;
      try {
        const buffer = await entry.buffer();
        const ext = path.extname(entry.path);
        const originalName = path.basename(entry.path);
        const uniqueName = `${uuidv4()}${ext}`;
        const { path: githubPath, rawUrl, repo } = await uploadFileToGithub(buffer, uniqueName, category);
        const title = path.basename(originalName, ext);
        const { rows } = await pool.query(
          `INSERT INTO media (id,title,description,category,filename,github_path,github_repo,file_size,mime_type,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [uuidv4(), title, null, category, originalName, githubPath, repo, buffer.length, 'application/octet-stream', req.user.id]
        );
        results.push({ ...rows[0], rawUrl });
      } catch (err) { errors.push({ file: entry.path, error: err.message }); }
    }
  } catch (err) { return res.status(500).json({ error: 'ZIP invalide: ' + err.message }); }
  res.json({ success: results, errors });
});

router.get('/list', authMiddleware, async (req, res) => {
  const { category } = req.query;
  let query = 'SELECT m.*, u.username as uploader FROM media m LEFT JOIN users u ON m.uploaded_by = u.id';
  const params = [];
  if (category) { params.push(category); query += ` WHERE m.category = $1`; }
  query += ' ORDER BY m.created_at DESC';
  const { rows } = await pool.query(query, params);
  const OWNER = process.env.GITHUB_OWNER;
  res.json(rows.map(m => ({ ...m, rawUrl: `https://raw.githubusercontent.com/${OWNER}/${m.github_repo}/main/${m.github_path}` })));
});

router.patch('/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Introuvable' });
  if (rows[0].uploaded_by !== req.user.id && req.user.role !== 'owner') return res.status(403).json({ error: 'Non autorisé' });
  const { rows: updated } = await pool.query(`UPDATE media SET title=COALESCE($1,title), description=COALESCE($2,description), updated_at=NOW() WHERE id=$3 RETURNING *`, [req.body.title, req.body.description, req.params.id]);
  res.json(updated[0]);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Introuvable' });
  if (rows[0].uploaded_by !== req.user.id && req.user.role !== 'owner') return res.status(403).json({ error: 'Non autorisé' });
  await deleteFileFromGithub(rows[0].github_path);
  await pool.query('DELETE FROM media WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});
export default router;
