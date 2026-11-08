import mongoose from 'mongoose';
const schema = new mongoose.Schema({ id: { type: String, required: true, unique: true }, name: { type: String, required: true, trim: true, maxlength: 120 }, description: { type: String, default: '', maxlength: 1000 }, category: { type: String, default: '', trim: true, maxlength: 80 }, price: { type: Number, min: 0.01, required: true }, available: { type: Boolean, default: true }, seededDefault: { type: Boolean, default: false } }, { timestamps: true });
schema.index({ category: 1, available: 1 });
export default mongoose.model('MenuItem', schema);
