import mongoose from 'mongoose';

export default async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  if (!/^mongodb(?:\+srv)?:\/\//i.test(process.env.MONGODB_URI)) throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv://.');
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 10000, maxPoolSize: 20 });
  } catch (error) {
    const safeError = new Error('MongoDB connection failed. Verify the Atlas URI, credentials, and Network Access allowlist.');
    safeError.name = 'MongoConnectionError';
    safeError.causeName = String(error.name || 'Error').slice(0, 80);
    throw safeError;
  }
  console.log('MongoDB connected');
}
