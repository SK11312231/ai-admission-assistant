// routes/followUpSequences.ts
// ─────────────────────────────────────────────────────────────────────────────
// Follow-up Sequences — Growth plan feature
//
// Allows institutes to configure automatic follow-up messages sent when a
// student goes silent after an inquiry. Supports 2 steps:
//   Step 1: sent after step1_delay_hours of silence (default 24h)
//   Step 2: sent after step2_delay_hours after step 1 (default 72h)
//
// If message text is null → AI generates a contextual follow-up automatically.
//
// Mount in index.ts:
//   import sequencesRouter from './routes/followUpSequences';
//   app.use('/api/sequences', defaultLimiter, sequencesRouter);
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import pool from '../db';
import { getLimits, getInstitutePlan } from './planLimits';

const router = Router();

// ── Plan gate helper ──────────────────────────────────────────────────────────

async function requireSequencesPlan(
  instituteId: number,
  res: Response,
): Promise<boolean> {
  const plan = await getInstitutePlan(instituteId);
  const limits = getLimits(plan);
  if (!limits.follow_up_sequences) {
    res.status(403).json({
      error: 'Follow-up Sequences is a Pro plan feature. Upgrade to access.',
      code: 'PLAN_UPGRADE_REQUIRED',
      required_plan: 'pro',
    });
    return false;
  }
  return true;
}

// ── GET /api/sequences/:instituteId ──────────────────────────────────────────
// Returns current sequence config for an institute (or defaults if none set)

router.get('/:instituteId', async (req: Request, res: Response) => {
  const id = Number(req.params.instituteId);
  try {
    const result = await pool.query(
      `SELECT * FROM follow_up_sequences WHERE institute_id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      // Return default config (not yet saved)
      res.json({
        institute_id:      id,
        is_enabled:        false,
        step1_delay_hours: 24,
        step1_message:     null,
        step2_delay_hours: 72,
        step2_message:     null,
        is_default:        true,
      });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Sequences] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch sequence config.' });
  }
});

// ── PUT /api/sequences/:instituteId ──────────────────────────────────────────
// Create or update sequence config for an institute

router.put('/:instituteId', async (req: Request, res: Response) => {
  const id = Number(req.params.instituteId);

  const {
    is_enabled,
    step1_delay_hours,
    step1_message,
    step2_delay_hours,
    step2_message,
  } = req.body as {
    is_enabled?:        boolean;
    step1_delay_hours?: number;
    step1_message?:     string | null;
    step2_delay_hours?: number;
    step2_message?:     string | null;
  };

  // Plan gate — only Growth+ can enable sequences
  if (is_enabled) {
    const allowed = await requireSequencesPlan(id, res);
    if (!allowed) return;
  }

  // Validate delays
  const s1delay = step1_delay_hours ?? 24;
  const s2delay = step2_delay_hours ?? 72;

  if (s1delay < 1 || s1delay > 168) {
    res.status(400).json({ error: 'Step 1 delay must be between 1 and 168 hours.' });
    return;
  }
  if (s2delay < 1 || s2delay > 336) {
    res.status(400).json({ error: 'Step 2 delay must be between 1 and 336 hours.' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO follow_up_sequences
         (institute_id, is_enabled, step1_delay_hours, step1_message,
          step2_delay_hours, step2_message, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (institute_id)
       DO UPDATE SET
         is_enabled        = EXCLUDED.is_enabled,
         step1_delay_hours = EXCLUDED.step1_delay_hours,
         step1_message     = EXCLUDED.step1_message,
         step2_delay_hours = EXCLUDED.step2_delay_hours,
         step2_message     = EXCLUDED.step2_message,
         updated_at        = NOW()
       RETURNING *`,
      [
        id,
        is_enabled ?? false,
        s1delay,
        step1_message?.trim() || null,
        s2delay,
        step2_message?.trim() || null,
      ],
    );

    console.log(`[Sequences] Config saved for institute ${id} (enabled: ${is_enabled ?? false})`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Sequences] PUT error:', err);
    res.status(500).json({ error: 'Failed to save sequence config.' });
  }
});

// ── GET /api/sequences/:instituteId/stats ────────────────────────────────────
// Returns execution stats for the current month

router.get('/:instituteId/stats', async (req: Request, res: Response) => {
  const id = Number(req.params.instituteId);
  try {
    const result = await pool.query(
      `SELECT
         step,
         COUNT(*) AS total_sent,
         COUNT(*) FILTER (WHERE sent_at >= date_trunc('month', NOW())) AS sent_this_month
       FROM sequence_executions
       WHERE institute_id = $1
       GROUP BY step
       ORDER BY step`,
      [id],
    );

    const stats = { step1: { total: 0, this_month: 0 }, step2: { total: 0, this_month: 0 } };
    for (const row of result.rows) {
      const key = row.step === 1 ? 'step1' : 'step2';
      stats[key] = { total: Number(row.total_sent), this_month: Number(row.sent_this_month) };
    }

    res.json(stats);
  } catch (err) {
    console.error('[Sequences] stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ── DELETE /api/sequences/:instituteId/lead/:leadId ──────────────────────────
// Opt a specific lead out of the sequence (stops further auto follow-ups)

router.delete('/:instituteId/lead/:leadId', async (req: Request, res: Response) => {
  const leadId = Number(req.params.leadId);
  try {
    // Insert dummy executions for both steps to prevent future sends
    await pool.query(
      `INSERT INTO sequence_executions (lead_id, institute_id, step, message_sent)
       VALUES ($1, $2, 1, 'opted_out'), ($1, $2, 2, 'opted_out')
       ON CONFLICT (lead_id, step) DO NOTHING`,
      [leadId, Number(req.params.instituteId)],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Sequences] opt-out error:', err);
    res.status(500).json({ error: 'Failed to opt out lead.' });
  }
});

export default router;
