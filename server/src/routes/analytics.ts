import { Router, Request, Response } from 'express';
import pool from '../db';
import { getLimits, getInstitutePlan } from './planLimits';

const router = Router();

// ── Plan gate middleware for analytics ───────────────────────────────────────
// Analytics is a Growth/Pro feature — Starter gets 403

async function requireAnalyticsPlan(req: Request, res: Response, next: () => void): Promise<void> {
  const instituteId = Number(req.params.instituteId);
  if (!instituteId) { res.status(400).json({ error: 'Invalid institute ID.' }); return; }
  const plan = await getInstitutePlan(instituteId);
  const limits = getLimits(plan);
  if (!limits.analytics) {
    res.status(403).json({
      error: 'Analytics is a Growth plan feature. Upgrade to access.',
      code: 'PLAN_UPGRADE_REQUIRED',
      required_plan: 'growth',
    });
    return;
  }
  next();
}

// ── GET /api/analytics/:instituteId/overview ─────────────────────────────────
// KPI cards: total leads, conversion rate, leads this week, avg daily

router.get('/:instituteId/overview', requireAnalyticsPlan, async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  const id = Number(instituteId);

  try {
    const [total, byStatus, thisWeek, lastWeek] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS count FROM leads WHERE institute_id = $1`,
        [id]
      ),
      pool.query(
        `SELECT status, COUNT(*) AS count FROM leads WHERE institute_id = $1 GROUP BY status`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*) AS count FROM leads
         WHERE institute_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*) AS count FROM leads
         WHERE institute_id = $1
         AND created_at >= NOW() - INTERVAL '14 days'
         AND created_at < NOW() - INTERVAL '7 days'`,
        [id]
      ),
    ]);

    const totalLeads = Number(total.rows[0]?.count ?? 0);
    const statusMap: Record<string, number> = {};
    for (const row of byStatus.rows) {
      statusMap[row.status as string] = Number(row.count);
    }

    const converted = statusMap['converted'] ?? 0;
    const conversionRate = totalLeads > 0
      ? Math.round((converted / totalLeads) * 100)
      : 0;

    const thisWeekCount = Number(thisWeek.rows[0]?.count ?? 0);
    const lastWeekCount = Number(lastWeek.rows[0]?.count ?? 0);
    const weekGrowth = lastWeekCount > 0
      ? Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100)
      : null;

    res.json({
      totalLeads,
      conversionRate,
      thisWeekLeads: thisWeekCount,
      weekGrowth,
      byStatus: statusMap,
    });
  } catch (err) {
    console.error('Analytics overview error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics overview.' });
  }
});

// ── GET /api/analytics/:instituteId/leads-over-time?days=7|30 ───────────────
// Daily lead counts for sparkline/line chart

router.get('/:instituteId/leads-over-time', requireAnalyticsPlan, async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  const days = req.query.days === '30' ? 30 : 7;
  const id = Number(instituteId);

  try {
    const result = await pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Kolkata'), 'DD Mon') AS label,
         COUNT(*) AS count
       FROM leads
       WHERE institute_id = $1
         AND created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Kolkata')
       ORDER BY DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Kolkata') ASC`,
      [id]
    );

    // Fill in missing days with 0
    const dataMap: Record<string, number> = {};
    for (const row of result.rows) {
      dataMap[row.label as string] = Number(row.count);
    }

    const filled: { label: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      filled.push({ label, count: dataMap[label] ?? 0 });
    }

    res.json(filled);
  } catch (err) {
    console.error('Analytics leads-over-time error:', err);
    res.status(500).json({ error: 'Failed to fetch leads over time.' });
  }
});

// ── GET /api/analytics/:instituteId/peak-hours ───────────────────────────────
// Message counts grouped by hour of day (IST)

router.get('/:instituteId/peak-hours', requireAnalyticsPlan, async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  const id = Number(instituteId);

  try {
    const result = await pool.query(
      `SELECT
         EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
         COUNT(*) AS count
       FROM leads
       WHERE institute_id = $1
       GROUP BY hour
       ORDER BY hour ASC`,
      [id]
    );

    // Fill all 24 hours
    const hourMap: Record<number, number> = {};
    for (const row of result.rows) {
      hourMap[Number(row.hour)] = Number(row.count);
    }

    const filled = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`,
      count: hourMap[h] ?? 0,
    }));

    res.json(filled);
  } catch (err) {
    console.error('Analytics peak-hours error:', err);
    res.status(500).json({ error: 'Failed to fetch peak hours.' });
  }
});

// ── GET /api/analytics/:instituteId/status-breakdown ────────────────────────
// Donut chart data

router.get('/:instituteId/status-breakdown', requireAnalyticsPlan, async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  const id = Number(instituteId);

  try {
    const result = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM leads
       WHERE institute_id = $1
       GROUP BY status`,
      [id]
    );

    const colors: Record<string, string> = {
      new:       '#6366f1',
      contacted: '#f59e0b',
      converted: '#10b981',
      lost:      '#ef4444',
    };

    const data = result.rows.map(row => ({
      name: (row.status as string).charAt(0).toUpperCase() + (row.status as string).slice(1),
      value: Number(row.count),
      color: colors[row.status as string] ?? '#94a3b8',
    }));

    res.json(data);
  } catch (err) {
    console.error('Analytics status-breakdown error:', err);
    res.status(500).json({ error: 'Failed to fetch status breakdown.' });
  }
});

export default router;