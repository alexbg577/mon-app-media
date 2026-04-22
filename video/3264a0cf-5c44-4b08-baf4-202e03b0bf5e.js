import jwt from 'jsonwebtoken';
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  try { req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token invalide' }); }
}
export function ownerMiddleware(req, res, next) {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Accès owner uniquement' });
  next();
}
