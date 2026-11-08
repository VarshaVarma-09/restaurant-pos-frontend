import mongoose from 'mongoose';
const roles = ['Waiter', 'Cashier', 'Manager', 'Owner', 'Kitchen Staff'];
const userSchema = new mongoose.Schema({ username: { type: String, required: true, trim: true, lowercase: true }, name: { type: String, required: true, trim: true }, passwordHash: { type: String, required: true, select: false }, role: { type: String, enum: roles, required: true }, staffProfileId: { type: String, default: null }, authVersion: { type: Number, min: 0, default: 0 }, active: { type: Boolean, default: true } }, { timestamps: true });
userSchema.index({ username: 1 }, { unique: true });
export default mongoose.model('User', userSchema);
