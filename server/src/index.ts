import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import pool, { initDB } from './db';
import { seed } from './seed';
import institutesRouter from './routes/institutes';
import leadsRouter from './routes/leads';
import webhookRouter from './routes/webhook';
import chatRouter from './routes/chat';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Fail fast if DATABASE_URL is not configured
if (!process.env.DATABASE_URL) {
  console.error(
    '\n❌ DATABASE_URL is not set.\n' +
    '   Link the PostgreSQL service to this service in Railway:\n' +
    '   Railway Dashboard → Service → Variables → Add Variable Reference → Select Postgres\n' +
    '   Then redeploy.\n'
  );
  process.exit(1);
}

// Warn early if WhatsApp keys are missing
if (!process.env.WHATSAPP_API_TOKEN) {
  console.warn(
    '\n⚠️  WHATSAPP_API_TOKEN is not configured.\n' +
    '   The WhatsApp auto-reply feature will not work until a valid token is set.\n' +
    '   Add it to server/.env\n',
  );
}

// Middleware
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
].filter(Boolean) as string[];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Rate limiters
const defaultLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// API Routes — must be registered BEFORE static file serving
app.use('/api/institutes', defaultLimiter, institutesRouter);
app.use('/api/leads', defaultLimiter, leadsRouter);
app.use('/api/chat', defaultLimiter, chatRouter);
app.use('/api/webhook', webhookRouter);

// Health check — verifies DB connectivity
app.get('/health', defaultLimiter, async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ status: 'error', db: 'disconnected', error: message });
  }
});

// Serve the compiled React frontend (from client/dist, relative to repo root)
// In production on Railway, process.cwd() is the repo root
const clientDist = path.join(process.cwd(), 'client', 'dist');
if (!fs.existsSync(clientDist)) {
  console.warn(
    `\n⚠️  client/dist not found at ${clientDist}.\n` +
    '   Run "npm run build --workspace=client" to build the frontend.\n'
  );
}
app.use(express.static(clientDist));

// SPA fallback — for any non-API route, serve index.html so React Router works
app.get('*', defaultLimiter, (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Initialise the database schema, seed sample data, then start the server
(async () => {
  try {
    await initDB();
    console.log('✅ Database tables initialised.');

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    await seed();
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
})();
