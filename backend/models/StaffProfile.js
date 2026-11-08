import mongoose from 'mongoose';
// Legacy waiter registry profiles have no credentials; authentication is only enabled through User records.
export default mongoose.model('StaffProfile', new mongoose.Schema({ id: { type: String, required: true, unique: true }, username: { type: String, required: true, lowercase: true, trim: true }, name: { type: String, required: true, trim: true }, role: { type: String, enum: ['Waiter'], default: 'Waiter' }, active: { type: Boolean, default: true } }, { timestamps: true }));
