import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db';

const router = Router();

interface InstituteRow {
  id: number;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  plan: string;
  password_hash: string;
  created_at: string;
}

// Password hashing using PBKDF2 (designed for password storage, unlike plain SHA-256)
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const computed = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return computed === hash;
}

// POST /api/institutes/register — register a new institute
router.post('/register', async (req: Request, res: Response) => {
  const { name, email, phone, whatsapp_number, plan, password } = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    whatsapp_number?: string;
    plan?: string;
    password?: string;
  };

  // Validation
  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: 'Institute name is required.' });
    return;
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }
  if (!phone || typeof phone !== 'string' || phone.trim() === '') {
    res.status(400).json({ error: 'Phone number is required.' });
    return;
  }
  if (!whatsapp_number || typeof whatsapp_number !== 'string' || whatsapp_number.trim() === '') {
    res.status(400).json({ error: 'WhatsApp number is required.' });
    return;
  }
  if (!plan || !['free', 'advance', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Plan must be one of: free, advance, pro.' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  try {
    // Check for duplicate email or WhatsApp number
    const existing = await pool.query(
      'SELECT id FROM institutes WHERE email = $1 OR whatsapp_number = $2',
      [email.trim().toLowerCase(), whatsapp_number.trim()]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'An institute with this email or WhatsApp number already exists.' });
      return;
    }

    const passwordHash = hashPassword(password);

    const result = await pool.query(
      `INSERT INTO institutes (name, email, phone, whatsapp_number, plan, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        whatsapp_number.trim(),
        plan,
        passwordHash,
      ]
    );

    res.status(201).json({
      id: result.rows[0].id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      whatsapp_number: whatsapp_number.trim(),
      plan,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register institute.' });
  }
});

// POST /api/institutes/login — authenticate an institute
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: 'Password is required.' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT * FROM institutes WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const institute = result.rows[0] as InstituteRow | undefined;

    if (!institute || !verifyPassword(password, institute.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    res.json({
      id: institute.id,
      name: institute.name,
      email: institute.email,
      phone: institute.phone,
      whatsapp_number: institute.whatsapp_number,
      plan: institute.plan,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login.' });
  }
});

export default router;
