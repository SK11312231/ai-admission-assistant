import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import qrcode from 'qrcode';
import pool from '../db';
import { initSession, getSessionState, disconnectSession } from './whatsappManager';
import { scrapeAndEnrich, getInstituteDetails } from './instituteEnrichment';

const router = Router();

interface InstituteRow {
  id: number;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  website: string | null;
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
  const { name, email, phone, whatsapp_number, website, plan, password } = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    whatsapp_number?: string;
    website?: string;
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
  if (!plan || !['free', 'advanced', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Plan must be one of: free, advanced, pro.' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  // website is optional — validate format if provided
  const websiteClean = website && typeof website === 'string' && website.trim() !== ''
    ? website.trim()
    : null;

  try {
    const existing = await pool.query(
      'SELECT id FROM institutes WHERE email = $1 OR whatsapp_number = $2',
      [email.trim().toLowerCase(), whatsapp_number.trim()]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'An institute with this email or WhatsApp number already exists.' });
      return;
    }

    // Ensure the website column exists (safe migration)
    await pool.query(`
      ALTER TABLE institutes ADD COLUMN IF NOT EXISTS website TEXT
    `);

    const passwordHash = hashPassword(password);
    const result = await pool.query(
      `INSERT INTO institutes (name, email, phone, whatsapp_number, website, plan, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        whatsapp_number.trim(),
        websiteClean,
        plan,
        passwordHash,
      ]
    );

    const newId: number = result.rows[0].id;

    // Fire-and-forget: enrich institute data in background (does not block registration response)
    void scrapeAndEnrich(newId, name.trim(), websiteClean);

    res.status(201).json({
      id: newId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      whatsapp_number: whatsapp_number.trim(),
      website: websiteClean,
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
      website: institute.website ?? null,
      plan: institute.plan,
      whatsapp_connected: institute.whatsapp_connected ?? false,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login.' });
  }
});

// GET /api/institutes/:id/details
// Returns the AI-enriched institute profile data.
router.get('/:id/details', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = await getInstituteDetails(Number(id));
    res.json({ institute_data: data });
  } catch (err) {
    console.error('Get details error:', err);
    res.status(500).json({ error: 'Failed to fetch institute details.' });
  }
});

// PUT /api/institutes/:id/details
// Allows institute to manually update their profile data from the dashboard.
router.put('/:id/details', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { institute_data } = req.body as { institute_data?: string };

  if (!institute_data || typeof institute_data !== 'string' || institute_data.trim() === '') {
    res.status(400).json({ error: 'institute_data is required.' });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO institute_details (institute_id, institute_data, scraped_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (institute_id)
       DO UPDATE SET institute_data = EXCLUDED.institute_data, scraped_at = NOW()`,
      [Number(id), institute_data.trim()],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update details error:', err);
    res.status(500).json({ error: 'Failed to update institute details.' });
  }
});

// POST /api/institutes/:id/re-enrich
// Re-triggers website scraping and AI enrichment (useful if website was updated).
router.post('/:id/re-enrich', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT name, website FROM institutes WHERE id = $1',
      [Number(id)],
    );
    const inst = result.rows[0] as { name: string; website: string | null } | undefined;
    if (!inst) {
      res.status(404).json({ error: 'Institute not found.' });
      return;
    }
    // Fire-and-forget
    void scrapeAndEnrich(Number(id), inst.name, inst.website);
    res.json({ started: true, message: 'Re-enrichment started. Check back in a few seconds.' });
  } catch (err) {
    console.error('Re-enrich error:', err);
    res.status(500).json({ error: 'Failed to start re-enrichment.' });
  }
});

// POST /api/institutes/:id/connect-whatsapp
router.post('/:id/connect-whatsapp', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    void initSession(id);
    res.json({ started: true });
  } catch (err) {
    console.error('Connect WhatsApp error:', err);
    res.status(500).json({ error: 'Failed to start WhatsApp session.' });
  }
});

// GET /api/institutes/:id/whatsapp-status
router.get('/:id/whatsapp-status', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { status, qr } = getSessionState(id);
    let qrDataUrl: string | null = null;
    if (qr) qrDataUrl = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
    res.json({ status, qr: qrDataUrl });
  } catch (err) {
    console.error('WhatsApp status error:', err);
    res.status(500).json({ error: 'Failed to get WhatsApp status.' });
  }
});

// DELETE /api/institutes/:id/disconnect-whatsapp
router.delete('/:id/disconnect-whatsapp', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await disconnectSession(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Disconnect WhatsApp error:', err);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp.' });
  }
});

export default router;
