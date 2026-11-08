import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import StaffAuditEvent from '../models/StaffAuditEvent.js';

const OWNER_RESETTABLE_ROLES = ['Manager', 'Cashier', 'Waiter', 'Kitchen Staff'];
const MANAGER_RESETTABLE_ROLES = ['Cashier', 'Waiter', 'Kitchen Staff'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const safeStaff = user => ({
  id: String(user._id),
  name: user.name,
  username: user.username,
  role: user.role,
  active: user.active
});

export async function listResettableStaff(req, res, next) {
  try {
    const roles = req.user.role === 'Owner' ? OWNER_RESETTABLE_ROLES : MANAGER_RESETTABLE_ROLES;
    const users = await User.find({ role: { $in: roles } })
      .select('name username role active')
      .sort({ role: 1, name: 1 })
      .lean();
    res.json({ users: users.map(safeStaff) });
  } catch (error) { next(error); }
}

export async function resetStaffPassword(req, res, next) {
  let session;
  try {
    session = await mongoose.startSession();
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['password', 'confirmPassword'].includes(key)) ||
        typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
      throw fail('New password must be 8–128 characters.');
    }
    if (typeof body.confirmPassword !== 'string' || body.confirmPassword !== body.password) {
      throw fail('Password confirmation does not match.');
    }

    let result;
    await session.withTransaction(async () => {
      const target = await User.findById(req.params.id).session(session);
      if (!target) throw fail('Staff account not found.', 404);
      const permittedRoles = req.user.role === 'Owner' ? OWNER_RESETTABLE_ROLES : MANAGER_RESETTABLE_ROLES;
      if (!permittedRoles.includes(target.role)) throw fail('You cannot reset this account password.', 403);

      target.passwordHash = await bcrypt.hash(body.password, 12);
      target.authVersion = Number(target.authVersion || 0) + 1;
      await target.save({ session });

      const auditEvent = new StaffAuditEvent({
        id: randomUUID(),
        targetUserId: String(target._id),
        actorUserId: String(req.user._id),
        actorRole: req.user.role,
        targetRole: target.role,
        action: 'staff_password_reset'
      });
      await auditEvent.save({ session });
      result = safeStaff(target);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });

    res.json({ message: 'Password reset successfully.', user: result });
  } catch (error) { next(error); }
  finally { if (session) await session.endSession(); }
}
