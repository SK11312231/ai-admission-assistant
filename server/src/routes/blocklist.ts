import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// ── Ensure table exists ───────────────────────────────────────────────────────

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_numbers (
      id            SERIAL PRIMARY KEY,
      institute_id  INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
      phone         TEXT NOT NULL,
      reason        TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(institute_id, phone)
    )
  `);
}

// ── GET /api/blocklist/:instituteId ───────────────────────────────────────────

router.get('/:instituteId', async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  try {
    await ensureTable();
    const result = await pool.query(
      `SELECT * FROM blocked_numbers WHERE institute_id = $1 ORDER BY created_at DESC`,
      [Number(instituteId)],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Blocklist fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch blocklist.' });
  }
});

// ── POST /api/blocklist ───────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { institute_id, phone, reason } = req.body as {
    institute_id?: number;
    phone?: string;
    reason?: string;
  };

  if (!institute_id || !phone || phone.trim() === '') {
    res.status(400).json({ error: 'institute_id and phone are required.' });
    return;
  }

  // Normalise phone — strip spaces, dashes, +
  const normalised = phone.trim().replace(/[\s\-\+]/g, '');

  try {
    await ensureTable();
    const result = await pool.query(
      `INSERT INTO blocked_numbers (institute_id, phone, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (institute_id, phone) DO NOTHING
       RETURNING *`,
      [institute_id, normalised, reason?.trim() ?? null],
    );
    if (result.rows.length === 0) {
      res.status(409).json({ error: 'This number is already on the blocklist.' });
      return;
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Blocklist add error:', err);
    res.status(500).json({ error: 'Failed to add to blocklist.' });
  }
});

// ── DELETE /api/blocklist/:id ─────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await ensureTable();
    await pool.query(`DELETE FROM blocked_numbers WHERE id = $1`, [Number(id)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Blocklist remove error:', err);
    res.status(500).json({ error: 'Failed to remove from blocklist.' });
  }
});

// ── Helper: check if a phone is blocked (used by whatsappManager) ─────────────

export async function isNumberBlocked(
  instituteId: number,
  phone: string,
): Promise<boolean> {
  try {
    await ensureTable();
    const normalised = phone.trim().replace(/[\s\-\+]/g, '');
    const result = await pool.query(
      `SELECT 1 FROM blocked_numbers WHERE institute_id = $1 AND phone = $2`,
      [instituteId, normalised],
    );
    return result.rows.length > 0;
  } catch {
    return false; // fail open — don't block if DB check fails
  }
}

// ── Helper: add a phone to blocklist (used by leads.ts on Lost status) ────────

export async function addToBlocklist(
  instituteId: number,
  phone: string,
  reason: string,
): Promise<void> {
  try {
    await ensureTable();
    const normalised = phone.trim().replace(/[\s\-\+]/g, '');
    await pool.query(
      `INSERT INTO blocked_numbers (institute_id, phone, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (institute_id, phone) DO NOTHING`,
      [instituteId, normalised, reason],
    );
    console.log(`[Blocklist] Added ${normalised} for institute ${instituteId}`);
  } catch (err) {
    console.error('[Blocklist] addToBlocklist failed:', err);
  }
}

export default router;
