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

// PATCH /api/institutes/:id/plan
// Admin-only: directly sets the plan after manual approval of an upgrade request.
router.patch('/:id/plan', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body as { plan?: string };

  if (!plan || !['free', 'advanced', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Plan must be one of: free, advanced, pro.' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE institutes SET plan = $1 WHERE id = $2
       RETURNING id, name, email, phone, whatsapp_number, website, plan, whatsapp_connected`,
      [plan, Number(id)],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Institute not found.' });
      return;
    }

    // Mark any pending upgrade requests for this plan as approved
    await pool.query(
      `UPDATE upgrade_requests SET status = 'approved', resolved_at = NOW()
       WHERE institute_id = $1 AND requested_plan = $2 AND status = 'pending'`,
      [Number(id), plan],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan.' });
  }
});

// POST /api/institutes/:id/request-upgrade
// Institute requests a plan upgrade — saves request to DB and notifies admin by email.
router.post('/:id/request-upgrade', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body as { plan?: string };

  if (!plan || !['advanced', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Requested plan must be advanced or pro.' });
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upgrade_requests (
        id             SERIAL PRIMARY KEY,
        institute_id   INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
        requested_plan TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at    TIMESTAMPTZ
      )
    `);

    // Fetch institute details
    const instResult = await pool.query(
      `SELECT id, name, email, phone, plan FROM institutes WHERE id = $1`,
      [Number(id)],
    );
    const inst = instResult.rows[0] as {
      id: number; name: string; email: string; phone: string; plan: string;
    } | undefined;

    if (!inst) {
      res.status(404).json({ error: 'Institute not found.' });
      return;
    }

    // Don't allow requesting the same or lower plan
    if (inst.plan === plan) {
      res.status(400).json({ error: 'You are already on this plan.' });
      return;
    }

    // Check for existing pending request
    const existing = await pool.query(
      `SELECT id FROM upgrade_requests
       WHERE institute_id = $1 AND requested_plan = $2 AND status = 'pending'`,
      [Number(id), plan],
    );
    if ((existing.rowCount ?? 0) > 0) {
      res.status(409).json({ error: 'An upgrade request for this plan is already pending approval.' });
      return;
    }

    // Insert request record
    const reqResult = await pool.query(
      `INSERT INTO upgrade_requests (institute_id, requested_plan, status)
       VALUES ($1, $2, 'pending') RETURNING id`,
      [Number(id), plan],
    );
    const requestId: number = reqResult.rows[0].id;

    // Email admin
    const { sendUpgradeRequestEmail } = await import('./emailService');
    const adminEmail = process.env.ADMIN_EMAIL ?? process.env.EMAIL_USER ?? '';
    if (adminEmail) {
      void sendUpgradeRequestEmail({
        adminEmail,
        instituteName: inst.name,
        instituteEmail: inst.email,
        institutePhone: inst.phone,
        currentPlan: inst.plan,
        requestedPlan: plan,
        requestId,
      });
    }

    res.status(201).json({ success: true, requestId, status: 'pending' });
  } catch (err) {
    console.error('Request upgrade error:', err);
    res.status(500).json({ error: 'Failed to submit upgrade request.' });
  }
});

// GET /api/institutes/:id/upgrade-request
// Returns the current pending upgrade request for an institute, if any.
router.get('/:id/upgrade-request', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upgrade_requests (
        id             SERIAL PRIMARY KEY,
        institute_id   INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
        requested_plan TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at    TIMESTAMPTZ
      )
    `);

    const result = await pool.query(
      `SELECT id, requested_plan, status, created_at
       FROM upgrade_requests
       WHERE institute_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [Number(id)],
    );

    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error('Get upgrade request error:', err);
    res.status(500).json({ error: 'Failed to fetch upgrade request.' });
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
