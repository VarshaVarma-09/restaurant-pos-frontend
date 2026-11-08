import mongoose from 'mongoose';
// Retains the frontend's mature KOT, audit, notification and billing workflows while migrating them into MongoDB.
export default mongoose.model('RestaurantState', new mongoose.Schema({ key: { type: String, unique: true, default: 'default' }, data: { type: mongoose.Schema.Types.Mixed, required: true }, revision: { type: Number, default: 0 } }, { timestamps: true, optimisticConcurrency: true }));
