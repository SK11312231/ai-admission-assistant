import cron from 'node-cron';
import pool from './db';
import {
  sendFollowUpDueEmail,
  sendNoReplyReminderEmail,
  sendWeeklySummaryEmail,
} from './routes/emailService';
import { sendMessageToStudent, getAIReply } from './routes/whatsappManager';
import { getLimits, getInstitutePlan } from './routes/planLimits';

// ── Auto Follow-up Sequences ──────────────────────────────────────────────────
// Runs every hour — finds leads overdue for step 1 or step 2, sends messages

async function runFollowUpSequences(): Promise<void> {
  console.log('[Scheduler] Running follow-up sequences check...');
  let sent = 0;

  try {
    // Find all institutes with sequences enabled (Growth+ plan only)
    const seqResult = await pool.query(`
      SELECT fs.institute_id, fs.step1_delay_hours, fs.step1_message,
             fs.step2_delay_hours, fs.step2_message,
             i.plan, i.is_paid
      FROM follow_up_sequences fs
      JOIN institutes i ON i.id = fs.institute_id
      WHERE fs.is_enabled = TRUE
        AND i.is_active = TRUE
        AND i.is_paid = TRUE
    `);

    for (const seq of seqResult.rows) {
      const instituteId: number = seq.institute_id;

      // Verify plan allows sequences
      const limits = getLimits(seq.plan as string);
      if (!limits.follow_up_sequences) continue;

      // ── Step 1 candidates ────────────────────────────────────────────────
      // Leads where:
      //   - status = 'new' (not yet contacted)
      //   - last_activity_at is older than step1_delay_hours
      //   - step 1 has NOT been executed yet
      const step1Leads = await pool.query(`
        SELECT l.id, l.student_phone, l.student_name, l.message, l.institute_id
        FROM leads l
        WHERE l.institute_id = $1
          AND l.status = 'new'
          AND l.last_activity_at < NOW() - ($2 || ' hours')::interval
          AND NOT EXISTS (
            SELECT 1 FROM sequence_executions se
            WHERE se.lead_id = l.id AND se.step = 1
          )
      `, [instituteId, seq.step1_delay_hours]);

      for (const lead of step1Leads.rows) {
        try {
          const msg = await buildFollowUpMessage(lead, seq.step1_message as string | null, 1);
          const delivered = await sendMessageToStudent(
            String(instituteId),
            `${lead.student_phone as string}@c.us`,
            msg,
          );

          if (delivered) {
            await recordExecution(lead.id as number, instituteId, 1, msg);
            await pool.query(
              `UPDATE leads SET last_activity_at = NOW() WHERE id = $1`,
              [lead.id],
            );
            sent++;
            console.log(`[Sequences] Step 1 sent → lead ${lead.id} (institute ${instituteId})`);
          }
        } catch (err) {
          console.error(`[Sequences] Step 1 failed for lead ${lead.id}:`, err);
        }
      }

      // ── Step 2 candidates ────────────────────────────────────────────────
      // Leads where:
      //   - step 1 was already sent
      //   - step2_delay_hours have passed since step 1 was sent
      //   - student still hasn't replied (last_activity_at hasn't changed since step 1)
      //   - step 2 has NOT been executed yet
      const step2Leads = await pool.query(`
        SELECT l.id, l.student_phone, l.student_name, l.message, l.institute_id,
               se1.sent_at AS step1_sent_at
        FROM leads l
        JOIN sequence_executions se1 ON se1.lead_id = l.id AND se1.step = 1
        WHERE l.institute_id = $1
          AND l.status = 'new'
          AND se1.sent_at < NOW() - ($2 || ' hours')::interval
          AND l.last_activity_at <= se1.sent_at + INTERVAL '5 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM sequence_executions se2
            WHERE se2.lead_id = l.id AND se2.step = 2
          )
      `, [instituteId, seq.step2_delay_hours]);

      for (const lead of step2Leads.rows) {
        try {
          const msg = await buildFollowUpMessage(lead, seq.step2_message as string | null, 2);
          const delivered = await sendMessageToStudent(
            String(instituteId),
            `${lead.student_phone as string}@c.us`,
            msg,
          );

          if (delivered) {
            await recordExecution(lead.id as number, instituteId, 2, msg);
            await pool.query(
              `UPDATE leads SET last_activity_at = NOW() WHERE id = $1`,
              [lead.id],
            );
            sent++;
            console.log(`[Sequences] Step 2 sent → lead ${lead.id} (institute ${instituteId})`);
          }
        } catch (err) {
          console.error(`[Sequences] Step 2 failed for lead ${lead.id}:`, err);
        }
      }
    }

    console.log(`[Sequences] ✅ Done — ${sent} follow-up(s) sent this run`);
  } catch (err) {
    console.error('[Scheduler] runFollowUpSequences error:', err);
  }
}

// ── Build message (custom or AI-generated) ────────────────────────────────────

async function buildFollowUpMessage(
  lead: { id: number; student_phone: string; student_name: string | null; message: string; institute_id: number },
  customMessage: string | null,
  step: number,
): Promise<string> {
  // Use custom message if institute configured one
  if (customMessage && customMessage.trim() !== '' && customMessage !== 'opted_out') {
    const name = lead.student_name ?? 'there';
    return customMessage
      .replace(/\{name\}/gi, name)
      .replace(/\{student_name\}/gi, name);
  }

  // Otherwise generate via AI — reuse getAIReply with a follow-up prompt context
  const prompt = step === 1
    ? `[AUTO FOLLOW-UP STEP 1] Student hasn't responded since their initial inquiry. Send a warm, brief follow-up.`
    : `[AUTO FOLLOW-UP STEP 2] This is a second follow-up. Student still hasn't responded. Be friendly but acknowledge they may be busy. Keep it very brief.`;

  try {
    const aiMsg = await getAIReply(lead.institute_id, lead.student_phone, prompt);
    if (aiMsg && aiMsg.trim()) return aiMsg;
  } catch { /* fall through to default */ }

  // Fallback
  const name = lead.student_name ? `, ${lead.student_name}` : '';
  return step === 1
    ? `Hi${name}! Just checking if you're still interested in learning more about our courses. We'd love to help. 😊`
    : `Hi${name}! We noticed you hadn't responded yet. No worries — whenever you're ready, we're here to answer your questions!`;
}

// ── Record execution ──────────────────────────────────────────────────────────

async function recordExecution(
  leadId: number,
  instituteId: number,
  step: number,
  message: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO sequence_executions (lead_id, institute_id, step, message_sent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (lead_id, step) DO NOTHING`,
    [leadId, instituteId, step, message],
  );
  // Save to messages table for conversation history
  const lead = await pool.query(`SELECT student_phone FROM leads WHERE id = $1`, [leadId]);
  if (lead.rows[0]) {
    const sessionId = `wa-${instituteId}-${lead.rows[0].student_phone as string}`;
    await pool.query(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
      [sessionId, message],
    );
  }
}

// ── Subscription Expiry Check ─────────────────────────────────────────────────
// Runs every day at midnight IST
// Sets is_paid = FALSE for institutes whose subscription has expired

async function checkSubscriptionExpiry(): Promise<void> {
  console.log('[Scheduler] Checking subscription expiry...');
  try {
    // Find active subscriptions that have passed their expiry date
    const result = await pool.query(`
      SELECT s.institute_id, i.name, i.email, s.plan, s.billing_cycle, s.expires_at
      FROM subscriptions s
      JOIN institutes i ON i.id = s.institute_id
      WHERE s.status = 'active'
        AND s.expires_at < NOW()
        AND i.is_paid = TRUE
    `);

    for (const row of result.rows) {
      try {
        // Mark subscription as expired
        await pool.query(
          `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
           WHERE institute_id = $1 AND status = 'active'`,
          [row.institute_id],
        );

        // Set institute is_paid = false AND is_premium_accessible = false
        await pool.query(
          `UPDATE institutes SET is_paid = FALSE, is_premium_accessible = FALSE WHERE id = $1`,
          [row.institute_id],
        );

        console.log(`[Scheduler] Subscription expired: institute ${row.institute_id} (${row.name}) — plan ${row.plan}`);

        // TODO: Send subscription expired email to institute
        // void sendSubscriptionExpiredEmail({ toEmail: row.email, instituteName: row.name, plan: row.plan });
      } catch (err) {
        console.error(`[Scheduler] Expiry update failed for institute ${row.institute_id}:`, err);
      }
    }

    if (result.rows.length > 0) {
      console.log(`[Scheduler] ✅ Expired ${result.rows.length} subscription(s)`);
    } else {
      console.log('[Scheduler] No subscriptions to expire today.');
    }
  } catch (err) {
    console.error('[Scheduler] checkSubscriptionExpiry error:', err);
  }
}

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
  // Midnight daily — subscription expiry check
  cron.schedule('0 0 * * *', () => { void checkSubscriptionExpiry(); }, { timezone: 'Asia/Kolkata' });

  // Every hour — auto follow-up sequences (Growth+ plan feature)
  cron.schedule('0 * * * *', () => { void runFollowUpSequences(); }, { timezone: 'Asia/Kolkata' });

  // 9:00 AM daily — follow-ups due today
  cron.schedule('0 9 * * *', () => { void checkFollowUpsDue(); }, { timezone: 'Asia/Kolkata' });

  // 6:00 PM daily — 24h no-reply reminder
  cron.schedule('0 18 * * *', () => { void checkNoReplies(); }, { timezone: 'Asia/Kolkata' });

  // 8:00 AM every Monday — weekly summary
  cron.schedule('0 8 * * 1', () => { void sendWeeklySummaries(); }, { timezone: 'Asia/Kolkata' });

  console.log('[Scheduler] ✅ All cron jobs started (IST timezone)');
}