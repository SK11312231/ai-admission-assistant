// routes/broadcast.ts
// ─────────────────────────────────────────────────────────────────────────────
// Bulk Broadcast — Pro plan feature
//
// Allows Pro institutes to send a single WhatsApp message to multiple leads
// at once, filtered by lead status.
//
// Broadcast runs in background — sends one message every 3s to avoid
// WhatsApp rate limits. Progress tracked in DB.
//
// Mount in index.ts:
//   import broadcastRouter from './routes/broadcast';
//   app.use('/api/broadcast', defaultLimiter, broadcastRouter);
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import pool from '../db';
import { getLimits, getInstitutePlan } from './planLimits';
import { sendMessageToStudent } from './whatsappManager';

const router = Router();

// ── Plan gate ─────────────────────────────────────────────────────────────────

async function requireBroadcastPlan(
  instituteId: number,
  res: Response,
): Promise<boolean> {
  const plan = await getInstitutePlan(instituteId);
  const limits = getLimits(plan);
  if (!limits.bulk_broadcast) {
    res.status(403).json({
      error: 'Bulk Broadcast is a Pro plan feature. Upgrade to access.',
      code: 'PLAN_UPGRADE_REQUIRED',
      required_plan: 'pro',
    });
    return false;
  }
  return true;
}

// ── GET /api/broadcast/:instituteId ──────────────────────────────────────────
// List all broadcasts for an institute

router.get('/:instituteId', async (req: Request, res: Response) => {
  const id = Number(req.params.instituteId);
  try {
    const result = await pool.query(
      `SELECT * FROM broadcasts WHERE institute_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Broadcast] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch broadcasts.' });
  }
});

// ── GET /api/broadcast/:instituteId/preview ───────────────────────────────────
// Preview how many leads match a filter before sending

router.get('/:instituteId/preview', async (req: Request, res: Response) => {
  const id = Number(req.params.instituteId);
  const filter = (req.query.filter as string) ?? 'all';

  const VALID_FILTERS = ['all', 'new', 'contacted', 'converted', 'lost'];
  if (!VALID_FILTERS.includes(filter)) {
    res.status(400).json({ error: 'Invalid filter.' }); return;
  }

  try {
    const whereClause = filter === 'all'
      ? `institute_id = $1 AND status NOT IN ('lost')`
      : `institute_id = $1 AND status = $2`;
    const params = filter === 'all' ? [id] : [id, filter];

    const result = await pool.query(
      `SELECT COUNT(*) AS count, array_agg(student_phone) AS phones
       FROM leads WHERE ${whereClause} AND student_phone IS NOT NULL`,
      params,
    );

    res.json({
      count: Number(result.rows[0]?.count ?? 0),
      filter,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to preview.' });
  }
});

// ── POST /api/broadcast/:instituteId ─────────────────────────────────────────
// Create and immediately start a broadcast

router.post('/:instituteId', async (req: Request, res: Response) => {
  const id = Number(req.params.instituteId);
  const { name, message, target_filter } = req.body as {
    name?: string;
    message?: string;
    target_filter?: string;
  };

  if (!await requireBroadcastPlan(id, res)) return;

  if (!name?.trim()) { res.status(400).json({ error: 'Broadcast name is required.' }); return; }
  if (!message?.trim()) { res.status(400).json({ error: 'Message is required.' }); return; }
  if (message.trim().length > 1000) { res.status(400).json({ error: 'Message must be under 1000 characters.' }); return; }

  const filter = target_filter ?? 'all';
  const VALID_FILTERS = ['all', 'new', 'contacted', 'converted'];
  if (!VALID_FILTERS.includes(filter)) {
    res.status(400).json({ error: `Invalid filter. Use: ${VALID_FILTERS.join(', ')}` }); return;
  }

  try {
    // Fetch target leads
    const whereClause = filter === 'all'
      ? `institute_id = $1 AND status NOT IN ('lost') AND student_phone IS NOT NULL`
      : `institute_id = $1 AND status = $2 AND student_phone IS NOT NULL`;
    const params = filter === 'all' ? [id] : [id, filter];

    const leadsResult = await pool.query(
      `SELECT id, student_phone FROM leads WHERE ${whereClause} ORDER BY last_activity_at DESC`,
      params,
    );
    const leads = leadsResult.rows as Array<{ id: number; student_phone: string }>;

    if (leads.length === 0) {
      res.status(400).json({ error: 'No leads found matching this filter.' }); return;
    }

    // Create broadcast record
    const insertResult = await pool.query(
      `INSERT INTO broadcasts (institute_id, name, message, status, target_filter, total_count)
       VALUES ($1, $2, $3, 'sending', $4, $5) RETURNING *`,
      [id, name.trim(), message.trim(), filter, leads.length],
    );
    const broadcast = insertResult.rows[0] as { id: number };

    // Mark started
    await pool.query(
      `UPDATE broadcasts SET started_at = NOW() WHERE id = $1`, [broadcast.id],
    );

    // Respond immediately — broadcast runs in background
    res.status(201).json({
      id: broadcast.id,
      status: 'sending',
      total_count: leads.length,
      message: `Broadcast started. Sending to ${leads.length} leads.`,
    });

    // Background send — staggered 3s apart to avoid WhatsApp rate limits
    void (async () => {
      let sent = 0;
      let failed = 0;

      for (const lead of leads) {
        try {
          // Format phone with @c.us if not already tagged
          const toNumber = lead.student_phone.includes('@')
            ? lead.student_phone
            : `${lead.student_phone}@c.us`;

          const ok = await sendMessageToStudent(String(id), toNumber, message.trim());
          if (ok) { sent++; } else { failed++; }
        } catch { failed++; }

        // Update progress every 5 sends
        if ((sent + failed) % 5 === 0) {
          await pool.query(
            `UPDATE broadcasts SET sent_count = $1, failed_count = $2 WHERE id = $3`,
            [sent, failed, broadcast.id],
          ).catch(() => { /* non-fatal */ });
        }

        // 3 second delay between each message
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Mark completed
      await pool.query(
        `UPDATE broadcasts
         SET status = 'completed', sent_count = $1, failed_count = $2, completed_at = NOW()
         WHERE id = $3`,
        [sent, failed, broadcast.id],
      );

      console.log(`[Broadcast] ✅ Completed broadcast ${broadcast.id} for institute ${id}: ${sent} sent, ${failed} failed`);
    })();
  } catch (err) {
    console.error('[Broadcast] POST error:', err);
    res.status(500).json({ error: 'Failed to start broadcast.' });
  }
});

// ── GET /api/broadcast/:instituteId/:broadcastId/status ───────────────────────
// Poll progress of a running broadcast

router.get('/:instituteId/:broadcastId/status', async (req: Request, res: Response) => {
  const broadcastId = Number(req.params.broadcastId);
  const instituteId = Number(req.params.instituteId);
  try {
    const result = await pool.query(
      `SELECT id, status, total_count, sent_count, failed_count, started_at, completed_at
       FROM broadcasts WHERE id = $1 AND institute_id = $2`,
      [broadcastId, instituteId],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Broadcast not found.' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get broadcast status.' });
  }
});

// ── DELETE /api/broadcast/:instituteId/:broadcastId ───────────────────────────
// Delete a completed/draft broadcast from history

router.delete('/:instituteId/:broadcastId', async (req: Request, res: Response) => {
  const broadcastId = Number(req.params.broadcastId);
  const instituteId = Number(req.params.instituteId);
  try {
    // Only allow deleting non-active broadcasts
    const result = await pool.query(
      `DELETE FROM broadcasts WHERE id = $1 AND institute_id = $2 AND status != 'sending'
       RETURNING id`,
      [broadcastId, instituteId],
    );
    if (result.rows.length === 0) {
      res.status(400).json({ error: 'Cannot delete a broadcast that is currently sending.' }); return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete broadcast.' });
  }
});

export default router;
