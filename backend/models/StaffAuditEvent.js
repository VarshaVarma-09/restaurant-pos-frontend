import mongoose from 'mongoose';

const staffAuditEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  targetUserId: { type: String, required: true, index: true },
  actorUserId: { type: String, required: true, index: true },
  actorRole: { type: String, required: true },
  targetRole: { type: String, required: true },
  action: { type: String, required: true, enum: ['staff_password_reset'] },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: false });

export default mongoose.model('StaffAuditEvent', staffAuditEventSchema);
