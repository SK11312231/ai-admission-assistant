import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import pool, { initDB } from './db';
import { seed } from './seed';
import institutesRouter from './routes/institutes';
import { restoreAllSessions } from './routes/whatsappManager';
import { startScheduler } from './scheduler';
import leadsRouter from './routes/leads';
import webhookRouter from './routes/webhook';
import chatRouter from './routes/chat';
import blocklistRouter from './routes/blocklist';
import analyticsRouter from './routes/analytics';
import widgetRouter from './routes/widget';

const app = express();
app.set('trust proxy', 1);
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

// Warn early if email is not configured
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn(
    '\n⚠️  EMAIL_USER or EMAIL_PASS is not configured.\n' +
    '   Email notifications will not work until both are set in Railway variables.\n'
  );
}

// Middleware
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
].filter(Boolean) as string[];

// Widget routes need open CORS — they're embedded on external institute websites
app.use('/api/widget', cors({ origin: '*' }));

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Rate limiters
const defaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// API Routes
app.use('/api/institutes', defaultLimiter, institutesRouter);
app.use('/api/leads', defaultLimiter, leadsRouter);
app.use('/api/chat', defaultLimiter, chatRouter);
app.use('/api/blocklist', defaultLimiter, blocklistRouter);
app.use('/api/analytics', defaultLimiter, analyticsRouter);
app.use('/api/widget', widgetRouter);
app.use('/api/webhook', webhookRouter);

// Health check
app.get('/health', defaultLimiter, async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ status: 'error', db: 'disconnected', error: message });
  }
});

// Serve the compiled React frontend
const clientDist = path.join(process.cwd(), 'client', 'dist');
if (!fs.existsSync(clientDist)) {
  console.warn(
    `\n⚠️  client/dist not found at ${clientDist}.\n` +
    '   Run "npm run build --workspace=client" to build the frontend.\n'
  );
}
app.use(express.static(clientDist));

// SPA fallback
app.get('*', defaultLimiter, (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Initialise DB, restore WhatsApp sessions, start scheduler, then listen
(async () => {
  try {
    await initDB();
    console.log('✅ Database tables initialised.');

    // Migration: update plan check constraint from 'advance' → 'advanced'
    try {
      await pool.query(`ALTER TABLE institutes DROP CONSTRAINT IF EXISTS institutes_plan_check`);
      await pool.query(`ALTER TABLE institutes ADD CONSTRAINT institutes_plan_check CHECK (plan IN ('free', 'advanced', 'pro'))`);
      console.log('✅ Plan constraint migrated.');
    } catch (err) {
      console.warn('⚠️  Plan constraint migration skipped (table may not exist yet):', err);
    }

    await restoreAllSessions();
    console.log('✅ WhatsApp sessions restored.');

    startScheduler();

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    await seed();
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
})();