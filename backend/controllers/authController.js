import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';

export const loginValidation = [body('username').trim().isLength({ min: 1, max: 120 }), body('password').isString().isLength({ min: 1, max: 128 })];
const sessionCookie = 'restaurantPosSession';
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api' };
function jwtCookieAge() {
  const match = String(process.env.JWT_EXPIRES_IN || '8h').match(/^(\d+)(s|m|h|d)$/i);
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match?.[2]?.toLowerCase()];
  return match ? Number(match[1]) * multiplier : 8 * 3_600_000;
}
function issueSessionCookie(res, token) { res.cookie(sessionCookie, token, { ...cookieOptions, maxAge: jwtCookieAge() }); }
export async function login(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Username and password are required.', errors: errors.array().map(({ path, msg }) => ({ field: path, message: msg })) });
    const user = await User.findOne({ username: req.body.username.trim().toLowerCase() }).select('+passwordHash');
    const passwordMatches = user?.passwordHash ? await bcrypt.compare(req.body.password, user.passwordHash) : false;
    if (!user?.active || !passwordMatches) return res.status(401).json({ message: 'Invalid username or password.' });
    if (req.body.expectedRole && req.body.expectedRole !== user.role) return res.status(409).json({ message: `This account has the ${user.role} role. Select that role to continue.` });
    const token = jwt.sign({ sub: user.id, ver: user.authVersion || 0 }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h', issuer: 'restaurant-pos' });
    issueSessionCookie(res, token);
    return res.json({ user: { id: user.staffProfileId || user.id, username: user.username, name: user.name, role: user.role } });
  } catch (error) { next(error); }
}
export async function me(req, res) { res.json({ user: { id: req.user.staffProfileId || req.user.id, username: req.user.username, name: req.user.name, role: req.user.role } }); }
export async function exchangeSession(req, res) {
  const token = jwt.sign({ sub: req.user.id, ver: req.user.authVersion || 0 }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h', issuer: 'restaurant-pos' });
  issueSessionCookie(res, token);
  res.json({ user: { id: req.user.staffProfileId || req.user.id, username: req.user.username, name: req.user.name, role: req.user.role } });
}
export async function logout(req, res, next) {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { authVersion: 1 } });
    res.clearCookie(sessionCookie, cookieOptions).json({ ok: true });
  } catch (error) { next(error); }
}
