import express from 'express';
import cors from 'cors';
import api from './routes/api.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim()), credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ message: 'Request body must be a JSON object.' });
  next();
});
app.use('/api', api);
app.use((req, res) => res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` }));
// Express error middleware requires all four parameters, including the unused next argument.
// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  if (error.code === 11000) return res.status(409).json({ message: 'A record with this unique value already exists.' });
  if (error.name === 'ValidationError') return res.status(400).json({ message: 'Request contains invalid data.' });
  if (error.name === 'CastError') return res.status(400).json({ message: 'An identifier or value has an invalid format.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Request JSON is invalid.' });
  if (!error.status || error.status >= 500) console.error('API request failed', { name: String(error.name || 'Error').slice(0, 80), code: typeof error.code === 'string' || typeof error.code === 'number' ? error.code : undefined });
  return res.status(error.status || 500).json({ message: error.status ? error.message : 'An unexpected server error occurred.' });
});
export default app;
