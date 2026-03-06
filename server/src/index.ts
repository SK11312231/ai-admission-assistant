import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { seed } from './seed';
import { ENV_PLACEHOLDER } from './constants';
import universitiesRouter from './routes/universities';
import chatRouter from './routes/chat';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Auto-seed the database with sample universities if it is empty
seed();

// Warn early if the OpenAI key is missing so developers see it immediately in the logs
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === ENV_PLACEHOLDER) {
  console.warn(
    '\n⚠️  OPENAI_API_KEY is not configured.\n' +
    '   The /api/chat endpoint will return errors until a valid key is set.\n' +
    '   Add it to server/.env — see .env.example for the format.\n',
  );
}

// Middleware
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Rate limiters
const defaultLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,             // 20 chat messages per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat requests, please try again in a moment.' },
});

// Routes
app.use('/api/universities', defaultLimiter, universitiesRouter);
app.use('/api/chat', chatLimiter, chatRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
