import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import app from './app.js';
import connectDB from './config/db.js';
import User from './models/User.js';
import Table from './models/Table.js';
import MenuItem from './models/MenuItem.js';
import RestaurantSettings from './models/RestaurantSettings.js';

const port = Number(process.env.PORT || 5000);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters');
if (process.env.JWT_SECRET === 'replace-with-a-long-random-secret') throw new Error('Replace the example JWT_SECRET before starting the server.');
if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_ORIGIN) throw new Error('CLIENT_ORIGIN must be configured in production.');
await connectDB();
await Promise.all(Object.values(mongoose.models).map(model => model.init()));
if (process.env.SEED_DEFAULT_BUSINESS_DATA === 'true') {
  if (!(await Table.exists({}))) await Table.insertMany(Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1), name: `Table ${index + 1}`, capacity: 4, status: 'Available', active: true, seededDefault: true })));
  if (!(await MenuItem.exists({}))) await MenuItem.insertMany([
    { id: '1', name: 'Chicken Biryani', price: 250, available: true, seededDefault: true }, { id: '2', name: 'Paneer Butter Masala', price: 220, available: true, seededDefault: true },
    { id: '3', name: 'Veg Fried Rice', price: 180, available: true, seededDefault: true }, { id: '4', name: 'Chicken 65', price: 200, available: true, seededDefault: true }
  ]);
}
await RestaurantSettings.updateOne({ key: 'default' }, { $setOnInsert: { key: 'default', seededDefault: true } }, { upsert: true });
if (process.env.BOOTSTRAP_OWNER_USERNAME && process.env.BOOTSTRAP_OWNER_PASSWORD) {
  if (process.env.BOOTSTRAP_OWNER_PASSWORD.length < 10) throw new Error('BOOTSTRAP_OWNER_PASSWORD must be at least 10 characters');
  if (process.env.BOOTSTRAP_OWNER_PASSWORD === 'change-this-before-use') throw new Error('Replace the example bootstrap password before starting the server.');
  const username = process.env.BOOTSTRAP_OWNER_USERNAME.trim().toLowerCase();
  if (!await User.exists({ username })) {
    await User.create({ username, name: 'Owner', role: 'Owner', passwordHash: await bcrypt.hash(process.env.BOOTSTRAP_OWNER_PASSWORD, 12) });
    console.log('Bootstrap owner created.');
  }
}
const server = app.listen(port, () => console.log(`Restaurant POS API listening on ${port}`));
let shuttingDown = false;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    try { await mongoose.disconnect(); }
    catch { process.exitCode = 1; }
  });
});
