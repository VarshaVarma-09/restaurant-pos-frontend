import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import { migrateLegacyState } from '../services/legacyMigration.js';
try { await connectDB(); console.log(await migrateLegacyState()); }
finally { await mongoose.disconnect(); }
