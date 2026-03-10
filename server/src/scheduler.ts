import cron from 'node-cron';
import pool from './db';
import {
  sendFollowUpDueEmail,
  sendNoReplyReminderEmail,
  sendWeeklySummaryEmail,
} from './routes/emailService';

// ── Follow-up Due Today ───────────────────────────────────────────────────────
// Runs every day at 9:00 AM

async function checkFollowUpsDue(): Promise<void> {
  console.log('[Scheduler] Checking follow-ups due today...');
  try {
    // Get all institutes that have leads with follow_up_date = today
    const result = await pool.query(`
      SELECT
        i.id AS institute_id,
        i.name AS institute_name,
        i.email AS institute_email,
        json_agg(json_build_object(
          'student_name', l.student_name,
          'student_phone', l.student_phone,
          'notes', l.notes,
          'follow_up_date', l.follow_up_date
        )) AS leads
      FROM leads l
      JOIN institutes i ON i.id = l.institute_id
      WHERE
        l.follow_up_date::date = CURRENT_DATE
        AND l.status NOT IN ('converted', 'lost')
      GROUP BY i.id, i.name, i.email
    `);

    for (const row of result.rows) {
      try {
        await sendFollowUpDueEmail({
          toEmail: row.institute_email as string,
          instituteName: row.institute_name as string,
          leads: row.leads as Array<{ student_name: string | null; student_phone: string; notes: string | null; follow_up_date: string }>,
        });
      } catch (err) {
        console.error(`[Scheduler] Follow-up email failed for institute ${row.institute_id}:`, err);
      }
    }

    console.log(`[Scheduler] Follow-up emails sent for ${result.rows.length} institute(s)`);
  } catch (err) {
    console.error('[Scheduler] checkFollowUpsDue error:', err);
  }
}

// ── 24h No-Reply Reminder ─────────────────────────────────────────────────────
// Runs every day at 6:00 PM

async function checkNoReplies(): Promise<void> {
  console.log('[Scheduler] Checking 24h no-reply leads...');
  try {
    const result = await pool.query(`
      SELECT
        i.id AS institute_id,
        i.name AS institute_name,
        i.email AS institute_email,
        json_agg(json_build_object(
          'student_name', l.student_name,
          'student_phone', l.student_phone,
          'message', l.message,
          'last_activity_at', l.last_activity_at
        )) AS leads
      FROM leads l
      JOIN institutes i ON i.id = l.institute_id
      WHERE
        l.last_activity_at < NOW() - INTERVAL '24 hours'
        AND l.last_activity_at > NOW() - INTERVAL '48 hours'
        AND l.status = 'new'
      GROUP BY i.id, i.name, i.email
    `);

    for (const row of result.rows) {
      try {
        await sendNoReplyReminderEmail({
          toEmail: row.institute_email as string,
          instituteName: row.institute_name as string,
          leads: row.leads as Array<{ student_name: string | null; student_phone: string; message: string; last_activity_at: string }>,
        });
      } catch (err) {
        console.error(`[Scheduler] No-reply email failed for institute ${row.institute_id}:`, err);
      }
    }

    console.log(`[Scheduler] No-reply emails sent for ${result.rows.length} institute(s)`);
  } catch (err) {
    console.error('[Scheduler] checkNoReplies error:', err);
  }
}

// ── Weekly Summary ────────────────────────────────────────────────────────────
// Runs every Monday at 8:00 AM

async function sendWeeklySummaries(): Promise<void> {
  console.log('[Scheduler] Sending weekly summaries...');
  try {
    const result = await pool.query(`
      SELECT
        i.id AS institute_id,
        i.name AS institute_name,
        i.email AS institute_email,
        COUNT(l.id) AS total_leads,
        COUNT(l.id) FILTER (WHERE l.created_at > NOW() - INTERVAL '7 days') AS new_this_week,
        COUNT(l.id) FILTER (WHERE l.status = 'contacted') AS contacted,
        COUNT(l.id) FILTER (WHERE l.status = 'converted') AS converted,
        COUNT(l.id) FILTER (WHERE l.status = 'lost') AS lost
      FROM institutes i
      LEFT JOIN leads l ON l.institute_id = i.id
      GROUP BY i.id, i.name, i.email
    `);

    for (const row of result.rows) {
      const total = Number(row.total_leads);
      const converted = Number(row.converted);
      const conversionRate = total > 0 ? `${Math.round((converted / total) * 100)}%` : '0%';

      try {
        await sendWeeklySummaryEmail({
          toEmail: row.institute_email as string,
          instituteName: row.institute_name as string,
          totalLeads: total,
          newThisWeek: Number(row.new_this_week),
          contacted: Number(row.contacted),
          converted,
          lost: Number(row.lost),
          conversionRate,
        });
      } catch (err) {
        console.error(`[Scheduler] Weekly summary failed for institute ${row.institute_id}:`, err);
      }
    }

    console.log(`[Scheduler] Weekly summaries sent for ${result.rows.length} institute(s)`);
  } catch (err) {
    console.error('[Scheduler] sendWeeklySummaries error:', err);
  }
}

// ── Start all cron jobs ───────────────────────────────────────────────────────

export function startScheduler(): void {
  // 9:00 AM daily — follow-ups due today
  cron.schedule('0 9 * * *', () => { void checkFollowUpsDue(); }, { timezone: 'Asia/Kolkata' });

  // 6:00 PM daily — 24h no-reply reminder
  cron.schedule('0 18 * * *', () => { void checkNoReplies(); }, { timezone: 'Asia/Kolkata' });

  // 8:00 AM every Monday — weekly summary
  cron.schedule('0 8 * * 1', () => { void sendWeeklySummaries(); }, { timezone: 'Asia/Kolkata' });

  console.log('[Scheduler] ✅ All cron jobs started (IST timezone)');
}
