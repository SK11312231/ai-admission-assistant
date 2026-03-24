import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import pool, { initDB } from './db';
import { getLimits, getInstitutePlan } from './routes/planLimits';
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
import adminRouter, { plansRouter } from './routes/admin';
import embeddedSignupRouter from './routes/embeddedSignup';
import trainingRouter from './routes/chatTraining';  // ← AI Training feature
import paymentRouter from './routes/payment';         // ← Razorpay payment

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

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '5mb' })); // increased for WhatsApp chat text uploads

// Rate limiters
const defaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// API Routes
app.use('/api/widget', cors({ origin: '*' }));
app.use('/api/institutes', defaultLimiter, institutesRouter);
app.use('/api/leads', defaultLimiter, leadsRouter);
app.use('/api/chat', defaultLimiter, chatRouter);
app.use('/api/blocklist', defaultLimiter, blocklistRouter);
app.use('/api/analytics', defaultLimiter, analyticsRouter);
// AI Training is a Growth/Pro feature — gate it at the router level
const trainingPlanGate = async (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  // Extract institute_id from body or query
  const instituteId = Number(
    (req.body as Record<string, unknown>)?.institute_id ??
    req.query.institute_id ??
    req.params.instituteId ?? 0
  );
  if (!instituteId) { next(); return; } // let route handler give proper error
  try {
    const plan = await getInstitutePlan(instituteId);
    const limits = getLimits(plan);
    if (!limits.ai_training) {
      res.status(403).json({
        error: 'AI Training is a Growth plan feature. Upgrade to access.',
        code: 'PLAN_UPGRADE_REQUIRED',
        required_plan: 'growth',
      });
      return;
    }
  } catch { /* fail open — let route handle */ }
  next();
};
app.use('/api/training', defaultLimiter, trainingPlanGate, trainingRouter);  // ← AI Training feature
app.use('/api/whatsapp', defaultLimiter, embeddedSignupRouter);  // ← Meta Embedded Signup
app.use('/api/widget', widgetRouter);
app.use('/api/admin', defaultLimiter, adminRouter);
app.use('/api/plans', defaultLimiter, plansRouter);      // ← public plans endpoint
app.use('/api/payment', defaultLimiter, paymentRouter);  // ← Razorpay payments
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

app.get('/demo', (_req, res) => {
  res.sendFile(path.join(clientDist, 'demo.html'));
});

app.get('/privacy-policy', (_req, res) => {
  res.sendFile(path.join(clientDist, 'privacy-policy.html'));
});

app.get('/terms-of-service', (_req, res) => {
  res.sendFile(path.join(clientDist, 'terms-of-service.html'));
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

// Serve the admin panel at /admin
const adminDist = path.join(process.cwd(), 'admin', 'dist');
if (!fs.existsSync(adminDist)) {
  console.warn(
    `\n⚠️  admin/dist not found at ${adminDist}.\n` +
    '   Run "npm run build" inside the admin/ folder.\n'
  );
}
app.use('/admin', express.static(adminDist));

// SPA fallback — admin routes first, then main app
app.get('/admin/*', defaultLimiter, (_req, res) => {
  res.sendFile(path.join(adminDist, 'index.html'));
});
app.get('*', defaultLimiter, (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Initialise DB, restore WhatsApp sessions, start scheduler, then listen
(async () => {
  try {
    await initDB();
    console.log('✅ Database tables initialised.');

    // Delay session restore to let the server stabilize first
    setTimeout(() => {
      void restoreAllSessions();
      console.log('✅ WhatsApp sessions restored.');
    }, 10_000); // 10 second delay

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