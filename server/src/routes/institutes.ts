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
  whatsapp_connected: boolean;
}

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

// POST /api/institutes/register
router.post('/register', async (req: Request, res: Response) => {
  const { name, email, phone, whatsapp_number, plan, password } = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    whatsapp_number?: string;
    plan?: string;
    password?: string;
  };

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
      [name.trim(), email.trim().toLowerCase(), phone.trim(), whatsapp_number.trim(), plan, passwordHash]
    );

    res.status(201).json({
      id: result.rows[0].id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      whatsapp_number: whatsapp_number.trim(),
      plan,
      whatsapp_connected: false,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register institute.' });
  }
});

// POST /api/institutes/login
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
      whatsapp_connected: institute.whatsapp_connected ?? false,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login.' });
  }
});

// POST /api/institutes/:id/connect-whatsapp
// Receives wabaId + phoneNumberId from the WA_EMBEDDED_SIGNUP FINISH postMessage on the frontend.
// Uses META_SYSTEM_USER_TOKEN to fetch phone number details and save to DB.
router.post('/:id/connect-whatsapp', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { wabaId, phoneNumberId } = req.body as {
    wabaId?: string;
    phoneNumberId?: string;
  };

  console.log('Connect WhatsApp request body:', JSON.stringify(req.body));

  if (!wabaId || typeof wabaId !== 'string' || wabaId.trim() === '') {
    res.status(400).json({ error: 'wabaId is required.' });
    return;
  }
  if (!phoneNumberId || typeof phoneNumberId !== 'string' || phoneNumberId.trim() === '') {
    res.status(400).json({ error: 'phoneNumberId is required.' });
    return;
  }

  const systemUserToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!systemUserToken) {
    res.status(500).json({ error: 'META_SYSTEM_USER_TOKEN is not configured on the server.' });
    return;
  }

  try {
    // Fetch phone number details using system user token
    const phoneRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId.trim()}?fields=id,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${systemUserToken}` } },
    );
    const phoneData = await phoneRes.json() as {
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      error?: { message: string };
    };

    console.log('Phone number fetch response:', JSON.stringify(phoneData));

    if (!phoneRes.ok || phoneData.error) {
      res.status(400).json({ error: phoneData.error?.message ?? 'Failed to fetch phone number details.' });
      return;
    }

    if (!phoneData.display_phone_number) {
      res.status(400).json({ error: 'Phone number details are missing from Meta response.' });
      return;
    }

    const displayPhoneNumber = phoneData.display_phone_number;

    // Subscribe phone number to our webhook (non-fatal if it fails)
    const subRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId.trim()}/subscribed_apps`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${systemUserToken}` },
      },
    );
    if (!subRes.ok) {
      const subErr = await subRes.text();
      console.error(`Webhook subscription failed for phone number ${phoneNumberId}: ${subErr}`);
    }

    // Save to DB
    await pool.query(
      `UPDATE institutes
       SET whatsapp_number = $1,
           whatsapp_phone_number_id = $2,
           whatsapp_waba_id = $3,
           whatsapp_access_token = $4,
           whatsapp_connected = TRUE
       WHERE id = $5`,
      [displayPhoneNumber, phoneNumberId.trim(), wabaId.trim(), systemUserToken, Number(id)],
    );

    res.json({
      success: true,
      whatsapp_number: displayPhoneNumber,
      phone_number_id: phoneNumberId.trim(),
      waba_id: wabaId.trim(),
    });
  } catch (err) {
    console.error('WhatsApp connect error:', err);
    res.status(500).json({ error: 'Failed to connect WhatsApp. Please try again.' });
  }
});

export default router;
