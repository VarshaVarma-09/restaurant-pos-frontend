import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const permissions = {
  Waiter: ['dashboard:view','orders:view','orders:viewAssigned','orders:create','orders:addItems','notifications:own','kitchen:serve','tables:view','menu:view'],
  Cashier: ['dashboard:view','dashboard:financial','orders:view','tables:view','menu:view','billing:view','billing:manage','reports:limited'],
  Manager: ['dashboard:view','dashboard:financial','orders:view','orders:create','orders:addItems','orders:manage','kitchen:view','kitchen:update','kitchen:serve','kitchen:cancel','tables:view','tables:manage','menu:view','menu:manage','billing:view','billing:manage','reports:full','reports:itemwise','notifications:manage','waiters:manage','settings:limited','audit:view','assistant:use'],
  Owner: ['dashboard:view','dashboard:financial','orders:view','orders:create','orders:addItems','orders:manage','kitchen:view','kitchen:update','kitchen:serve','kitchen:cancel','tables:view','tables:manage','menu:view','menu:manage','billing:view','billing:manage','reports:full','reports:itemwise','notifications:manage','waiters:manage','settings:full','audit:view','assistant:use'],
  'Kitchen Staff': ['dashboard:view','kitchen:view','kitchen:update']
};
function readSessionCookie(header = '') {
  const entry = header.split(';').map(part => part.trim()).find(part => part.startsWith('restaurantPosSession='));
  if (!entry) return '';
  try { return decodeURIComponent(entry.slice('restaurantPosSession='.length)); }
  catch { return ''; }
}
export async function authenticate(req, res, next) {
  let claims;
  try {
    const match = req.headers.authorization?.match(/^Bearer\s+([^\s]+)$/i);
    const cookieToken = readSessionCookie(req.headers.cookie);
    const token = match?.[1] || cookieToken;
    if (!token) return res.status(401).json({ message: 'Authentication required.' });
    if (!match && cookieToken && ['POST','PUT','PATCH','DELETE'].includes(req.method) && req.headers.origin) {
      const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim());
      if (!allowedOrigins.includes(req.headers.origin)) return res.status(403).json({ message: 'Request origin is not allowed.' });
    }
    claims = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'restaurant-pos', algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session.' });
  }
  try {
    const user = await User.findById(claims.sub);
    if (!user?.active) return res.status(401).json({ message: 'Account is inactive.' });
    if (Number(claims.ver ?? 0) !== Number(user.authVersion || 0)) return res.status(401).json({ message: 'Session is no longer valid.' });
    req.user = user;
    return next();
  } catch (error) { return next(error); }
}
export const allow = (...required) => (req, res, next) => {
  const granted = permissions[req.user?.role] || [];
  if (!required.some(permission => granted.includes(permission))) return res.status(403).json({ message: 'You do not have permission to perform this action.' });
  next();
};
