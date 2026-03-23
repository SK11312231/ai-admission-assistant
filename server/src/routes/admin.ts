import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../db';

const router = Router();

const JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? 'inquiai-admin-secret-change-in-prod';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

// ── Password helpers (async — avoids blocking Railway's event loop) ───────────

function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex') === hash);
    });
  });
}

// ── Ensure admins table + is_active column migration ────────────────────────

async function ensureAdminTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Safe migration: add is_active to institutes if it doesn't exist
  await pool.query(`
    ALTER TABLE institutes
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
  `);
}

// ── JWT middleware ───────────────────────────────────────────────────────────

interface AdminPayload { id: number; email: string; }

function verifyAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as AdminPayload;
    (req as Request & { admin: AdminPayload }).admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// ── POST /api/admin/login ────────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  try {
    await ensureAdminTable();
    const result = await pool.query('SELECT * FROM admins WHERE email = $1', [email.toLowerCase().trim()]);
    const admin = result.rows[0] as { id: number; name: string; email: string; password_hash: string } | undefined;
    if (!admin || !await verifyPassword(password, admin.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const token = jwt.sign({ id: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, name: admin.name, email: admin.email });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── POST /api/admin/create ───────────────────────────────────────────────────

router.post('/create', async (req: Request, res: Response) => {
  const { name, email, password, bootstrapKey } = req.body as {
    name?: string; email?: string; password?: string; bootstrapKey?: string;
  };
  console.error('req.body:', req.body);
  const expectedKey = process.env.ADMIN_BOOTSTRAP_KEY;
  if (!expectedKey || bootstrapKey !== expectedKey) {
    res.status(403).json({ error: 'Invalid bootstrap key.' });
    return;
  }
  console.error('Found the bootstrap key:');
  if (!name || !email || !password || password.length < 8) {
    res.status(400).json({ error: 'Name, email and password (min 8 chars) are required.' });
    return;
  }
  try {
    console.error('Entered in try statement');
    await ensureAdminTable();
    const hash = await hashPassword(password);
    console.error('Before inserting admin:');
    await pool.query(
      'INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
      [name.trim(), email.toLowerCase().trim(), hash],
    );
    console.error('Admin inserted successfully.');
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Failed to create admin.' });
  }
});

// ── All routes below require admin JWT ──────────────────────────────────────

router.use(verifyAdmin);

// ── GET /api/admin/overview ──────────────────────────────────────────────────

router.get('/overview', async (_req: Request, res: Response) => {
  try {
    await ensureAdminTable();
    const [institutes, leads, requests, planBreak, recentInstitutes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM institutes WHERE is_active = TRUE`),
      pool.query(`SELECT COUNT(*) FROM leads l JOIN institutes i ON i.id = l.institute_id WHERE i.is_active = TRUE`),
      pool.query(`SELECT COUNT(*) FROM upgrade_requests WHERE status = 'pending'`),
      pool.query(`SELECT plan, COUNT(*) AS count FROM institutes WHERE is_active = TRUE GROUP BY plan`),
      pool.query(`
        SELECT id, name, email, plan, created_at FROM institutes
        WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 5
      `),
    ]);
    const planMap: Record<string, number> = {};
    for (const row of planBreak.rows) planMap[row.plan as string] = Number(row.count);
    res.json({
      totalInstitutes: Number(institutes.rows[0].count),
      totalLeads: Number(leads.rows[0].count),
      pendingUpgrades: Number(requests.rows[0].count),
      planBreakdown: planMap,
      recentInstitutes: recentInstitutes.rows,
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ error: 'Failed to fetch overview.' });
  }
});

// ── GET /api/admin/institutes ────────────────────────────────────────────────
// ?inactive=true  →  returns deactivated institutes only

router.get('/institutes', async (req: Request, res: Response) => {
  const search = (req.query.search as string) ?? '';
  const inactive = req.query.inactive === 'true';
  try {
    const conditions: string[] = [`i.is_active = ${inactive ? 'FALSE' : 'TRUE'}`];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(i.name ILIKE $${params.length} OR i.email ILIKE $${params.length})`);
    }
    const result = await pool.query(`
      SELECT i.id, i.name, i.email, i.phone, i.whatsapp_number, i.website,
             i.plan, i.whatsapp_connected, i.is_active, i.created_at,
             COUNT(l.id) AS lead_count
      FROM institutes i
      LEFT JOIN leads l ON l.institute_id = i.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY i.id
      ORDER BY i.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin institutes error:', err);
    res.status(500).json({ error: 'Failed to fetch institutes.' });
  }
});

// ── PATCH /api/admin/institutes/:id/plan ────────────────────────────────────

router.patch('/institutes/:id/plan', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body as { plan?: string };
  if (!plan || !['starter', 'growth', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Plan must be starter, growth, or pro.' });
    return;
  }
  try {
    await pool.query(`UPDATE institutes SET plan = $1 WHERE id = $2`, [plan, Number(id)]);
    await pool.query(
      `UPDATE upgrade_requests SET status = 'approved', resolved_at = NOW()
       WHERE institute_id = $1 AND requested_plan = $2 AND status = 'pending'`,
      [Number(id), plan],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Admin update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan.' });
  }
});

// ── PATCH /api/admin/institutes/:id/deactivate ──────────────────────────────

router.patch('/institutes/:id/deactivate', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await pool.query(`UPDATE institutes SET is_active = FALSE WHERE id = $1`, [Number(id)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin deactivate error:', err);
    res.status(500).json({ error: 'Failed to deactivate institute.' });
  }
});

// ── PATCH /api/admin/institutes/:id/reactivate ──────────────────────────────

router.patch('/institutes/:id/reactivate', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await pool.query(`UPDATE institutes SET is_active = TRUE WHERE id = $1`, [Number(id)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin reactivate error:', err);
    res.status(500).json({ error: 'Failed to reactivate institute.' });
  }
});

// ── DELETE /api/admin/institutes/:id ────────────────────────────────────────
// Requires admin password. Only works on inactive institutes.

router.delete('/institutes/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { adminPassword } = req.body as { adminPassword?: string };
  const instId = Number(id);

  if (!adminPassword) {
    res.status(400).json({ error: 'Admin password is required.' });
    return;
  }
  try {
    // Verify admin password
    const adminPayload = (req as Request & { admin: AdminPayload }).admin;
    const adminResult = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [adminPayload.id]);
    const admin = adminResult.rows[0] as { password_hash: string } | undefined;
    if (!admin || !await verifyPassword(adminPassword, admin.password_hash)) {
      res.status(403).json({ error: 'Incorrect admin password.' });
      return;
    }

    // Guard: must be inactive first
    const instCheck = await pool.query(`SELECT is_active FROM institutes WHERE id = $1`, [instId]);
    const inst = instCheck.rows[0] as { is_active: boolean } | undefined;
    if (!inst) { res.status(404).json({ error: 'Institute not found.' }); return; }
    if (inst.is_active) {
      res.status(400).json({ error: 'Deactivate the institute first before permanently deleting.' });
      return;
    }

    // Hard delete inside transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Delete in correct dependency order using exact table names
      await client.query(`DELETE FROM blocked_numbers WHERE institute_id = $1`, [instId]);
      await client.query(`DELETE FROM upgrade_requests WHERE institute_id = $1`, [instId]);
      await client.query(`DELETE FROM institute_details WHERE institute_id = $1`, [instId]);
      await client.query(`DELETE FROM messages WHERE session_id LIKE $1`, [`wa-${instId}-%`]);
      await client.query(`DELETE FROM leads WHERE institute_id = $1`, [instId]);
      await client.query(`DELETE FROM institutes WHERE id = $1`, [instId]);
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Admin hard delete error:', err);
    res.status(500).json({ error: 'Failed to permanently delete institute.' });
  }
});

// ── GET /api/admin/upgrade-requests ─────────────────────────────────────────

router.get('/upgrade-requests', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT ur.id, ur.requested_plan, ur.status, ur.created_at, ur.resolved_at,
             i.id AS institute_id, i.name AS institute_name, i.email AS institute_email,
             i.phone AS institute_phone, i.plan AS current_plan
      FROM upgrade_requests ur
      JOIN institutes i ON i.id = ur.institute_id
      ORDER BY ur.status ASC, ur.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin upgrade requests error:', err);
    res.status(500).json({ error: 'Failed to fetch upgrade requests.' });
  }
});

// ── PATCH /api/admin/upgrade-requests/:id ───────────────────────────────────

router.patch('/upgrade-requests/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { action } = req.body as { action?: 'approve' | 'reject' };
  if (!action || !['approve', 'reject'].includes(action)) {
    res.status(400).json({ error: 'action must be approve or reject.' });
    return;
  }
  try {
    const reqResult = await pool.query(
      `SELECT institute_id, requested_plan FROM upgrade_requests WHERE id = $1`, [Number(id)]);
    const upgradeReq = reqResult.rows[0] as { institute_id: number; requested_plan: string } | undefined;
    if (!upgradeReq) { res.status(404).json({ error: 'Request not found.' }); return; }
    await pool.query(
      `UPDATE upgrade_requests SET status = $1, resolved_at = NOW() WHERE id = $2`,
      [action === 'approve' ? 'approved' : 'rejected', Number(id)],
    );
    if (action === 'approve') {
      await pool.query(`UPDATE institutes SET plan = $1 WHERE id = $2`,
        [upgradeReq.requested_plan, upgradeReq.institute_id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Admin upgrade action error:', err);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

// ── GET /api/admin/leads ─────────────────────────────────────────────────────

router.get('/leads', async (req: Request, res: Response) => {
  const search = (req.query.search as string) ?? '';
  const instituteId = req.query.institute_id ? Number(req.query.institute_id) : null;
  try {
    const conditions: string[] = ['i.is_active = TRUE'];
    const params: unknown[] = [];
    let idx = 1;
    if (search) {
      conditions.push(`(l.student_name ILIKE $${idx} OR l.student_phone ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }
    if (instituteId) {
      conditions.push(`l.institute_id = $${idx}`);
      params.push(instituteId); idx++;
    }
    const result = await pool.query(`
      SELECT l.id, l.student_name, l.student_phone, l.message, l.status,
             l.notes, l.follow_up_date, l.created_at,
             i.name AS institute_name, i.id AS institute_id
      FROM leads l
      JOIN institutes i ON i.id = l.institute_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY l.created_at DESC LIMIT 200
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads.' });
  }
});

// ── GET /api/admin/blocklist ─────────────────────────────────────────────────

router.get('/blocklist', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.phone, b.reason, b.created_at,
             i.name AS institute_name, i.id AS institute_id
      FROM blocked_numbers b
      JOIN institutes i ON i.id = b.institute_id
      WHERE i.is_active = TRUE
      ORDER BY b.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin blocklist error:', err);
    res.status(500).json({ error: 'Failed to fetch blocklist.' });
  }
});

// ── DELETE /api/admin/blocklist/:id ─────────────────────────────────────────

router.delete('/blocklist/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM blocked_numbers WHERE id = $1`, [Number(id)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete blocklist error:', err);
    res.status(500).json({ error: 'Failed to delete entry.' });
  }
});

// ── GET /api/admin/settings ──────────────────────────────────────────────────

router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const adminResult = await pool.query(`SELECT id, name, email, created_at FROM admins ORDER BY created_at ASC`);
    res.json({
      admins: adminResult.rows,
      env: {
        EMAIL_USER: process.env.EMAIL_USER ? `${process.env.EMAIL_USER.slice(0, 4)}****` : null,
        ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? null,
        API_BASE_URL: process.env.API_BASE_URL ?? null,
        CLIENT_URL: process.env.CLIENT_URL ?? null,
        GROQ_API_KEY: process.env.GROQ_API_KEY ? '****configured****' : null,
        WHATSAPP_API_TOKEN: process.env.WHATSAPP_API_TOKEN ? '****configured****' : null,
      },
    });
  } catch (err) {
    console.error('Admin settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

// ── POST /api/admin/admins ───────────────────────────────────────────────────

router.post('/admins', async (req: Request, res: Response) => {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
  if (!name || !email || !password || password.length < 8) {
    res.status(400).json({ error: 'Name, email and password (min 8 chars) are required.' });
    return;
  }
  try {
    await ensureAdminTable();
    const hash = await hashPassword(password);
    await pool.query(
      'INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3)',
      [name.trim(), email.toLowerCase().trim(), hash],
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Failed to create admin. Email may already exist.' });
  }
});

// ── Plans router ──────────────────────────────────────────────────────────────
// Mounted at:
//   GET  /api/plans               → public (Home.tsx, Register.tsx)
//   PATCH /api/admin/plans/:id    → protected by verifyAdmin inside this router

export const plansRouter = Router(); // ← separate instance, no verifyAdmin applied globally

// GET /api/plans — public, returns all active plans
plansRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, slug, name, badge, price_monthly, price_annual,
              description, features, limits, is_popular, sort_order
       FROM plans
       WHERE is_active = TRUE
       ORDER BY sort_order ASC`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /api/plans]', err);
    res.status(500).json({ error: 'Failed to fetch plans.' });
  }
});

// PATCH /api/admin/plans/:id — admin only, update any plan field
plansRouter.patch('/:id', verifyAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    name, badge, price_monthly, price_annual,
    description, features, limits, is_popular, is_active, sort_order,
  } = req.body as Record<string, unknown>;

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const addField = (col: string, val: unknown) => {
    if (val !== undefined) { fields.push(`${col} = $${idx++}`); values.push(val); }
  };

  addField('name',          name);
  addField('badge',         badge);
  addField('price_monthly', price_monthly);
  addField('price_annual',  price_annual);
  addField('description',   description);
  addField('features',      features ? JSON.stringify(features) : undefined);
  addField('limits',        limits   ? JSON.stringify(limits)   : undefined);
  addField('is_popular',    is_popular);
  addField('is_active',     is_active);
  addField('sort_order',    sort_order);
  fields.push('updated_at = NOW()');

  if (fields.length === 1) {
    res.status(400).json({ error: 'No fields to update.' });
    return;
  }

  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE plans SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Plan not found.' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PATCH /api/admin/plans/:id]', err);
    res.status(500).json({ error: 'Failed to update plan.' });
  }
});

export default router;