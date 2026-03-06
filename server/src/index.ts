import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { initDB } from './db';
import { seed } from './seed';
import institutesRouter from './routes/institutes';
import leadsRouter from './routes/leads';
import webhookRouter from './routes/webhook';

const app = express();
const PORT = process.env.PORT ?? 3001;

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

// Routes
app.use('/api/institutes', defaultLimiter, institutesRouter);
app.use('/api/leads', defaultLimiter, leadsRouter);
app.use('/api/webhook', webhookRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Initialise the database, seed sample data, then start the server
(async () => {
  try {
    await initDB();
    console.log('✅ Database tables initialised.');
    await seed();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
