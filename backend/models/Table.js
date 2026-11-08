import mongoose from 'mongoose';
const schema = new mongoose.Schema({ id: { type: String, required: true, unique: true }, name: { type: String, required: true, trim: true, maxlength: 60 }, nameKey: { type: String, select: false, unique: true, sparse: true }, capacity: { type: Number, min: 1, max: 50, default: 4 }, status: { type: String, enum: ['Available', 'Occupied', 'Reserved'], default: 'Available' }, active: { type: Boolean, default: true }, seededDefault: { type: Boolean, default: false } }, { timestamps: true });
schema.index({ active: 1, status: 1 });
export default mongoose.model('Table', schema);
