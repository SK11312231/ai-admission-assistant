import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import pool from '../db';
import { addToBlocklist } from './blocklist';
import { sendMessageToStudent } from './whatsappManager';
import { checkActiveleadsLimit, getInstitutePlan, getLimits, getAIUsageThisMonth } from './planLimits';

const router = Router();

// ── Lazy Groq client ─────────────────────────────────────────────────────────

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set.');
    openai = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return openai;
}

// ── Ensure leads table has notes + follow_up_date columns ────────────────────

async function ensureLeadColumns(): Promise<void> {
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW()`);
}

// ── Auto-extract student name from message using Groq ────────────────────────

async function extractStudentName(message: string): Promise<string | null> {
  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content:
            'You extract student names from WhatsApp admission enquiry messages. ' +
            'Reply with ONLY the name if found, or the word NULL if no name is present. ' +
            'No explanation, no punctuation — just the name or NULL.',
        },
        { role: 'user', content: message },
      ],
      temperature: 0,
      max_tokens: 20,
    });

    const result = completion.choices[0]?.message?.content?.trim() ?? 'NULL';
    return result === 'NULL' || result === '' ? null : result;
  } catch {
    return null;
  }
}

// ── Status sort order ────────────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  new: 0,
  contacted: 1,
  converted: 2,
  lost: 3,
};

function sortByStatus(leads: LeadRow[]): LeadRow[] {
  return [...leads].sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 99;
    const ob = STATUS_ORDER[b.status] ?? 99;
    if (oa !== ob) return oa - ob;
    // Within same status: newest first
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

interface LeadRow {
  id: number;
  institute_id: number;
  student_name: string | null;
  student_phone: string;
  message: string;
  status: string;
  notes: string | null;
  follow_up_date: string | null;
  last_activity_at: string;
  created_at: string;
}

// ── GET /api/leads/:instituteId ───────────────────────────────────────────────

router.get('/:instituteId', async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, institute_id, student_name, student_phone, message, status,
              notes, follow_up_date, last_activity_at, created_at
       FROM leads WHERE institute_id = $1`,
      [Number(instituteId)],
    );
    const sorted = sortByStatus(result.rows as LeadRow[]);
    res.json(sorted);
  } catch (err) {
    console.error('Fetch leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads.' });
  }
});

// ── GET /api/leads/:instituteId/usage ────────────────────────────────────────
// Returns current month AI response usage + active leads count vs plan limits
// Used by Dashboard to show usage bars

router.get('/:instituteId/usage', async (req: Request, res: Response) => {
  const id = Number(req.params.instituteId);
  try {
    const plan = await getInstitutePlan(id);
    const limits = getLimits(plan);
    const aiUsage = await getAIUsageThisMonth(id);

    const leadsResult = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE institute_id = $1 AND status NOT IN ('lost', 'converted')`,
      [id],
    );
    const activeLeads = Number(leadsResult.rows[0]?.count ?? 0);

    res.json({
      plan,
      ai_responses:     { used: aiUsage.used,  limit: aiUsage.limit },
      active_leads:     { used: activeLeads,    limit: limits.active_leads },
      whatsapp_numbers: { limit: limits.whatsapp_numbers },
    });
  } catch (err) {
    console.error('Usage fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch usage.' });
  }
});

// ── POST /api/leads — manually add a lead from dashboard ────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { institute_id, student_name, student_phone, message, notes, follow_up_date } =
    req.body as {
      institute_id?: number;
      student_name?: string;
      student_phone?: string;
      message?: string;
      notes?: string;
      follow_up_date?: string;
    };

  if (!institute_id || typeof institute_id !== 'number') {
    res.status(400).json({ error: 'institute_id is required.' });
    return;
  }
  if (!student_phone || typeof student_phone !== 'string' || student_phone.trim() === '') {
    res.status(400).json({ error: 'student_phone is required.' });
    return;
  }

  try {
    await ensureLeadColumns();

    // ── Active leads limit check ────────────────────────────────────────────
    const plan = await getInstitutePlan(institute_id);
    const limitCheck = await checkActiveleadsLimit(institute_id, plan);
    if (!limitCheck.allowed) {
      res.status(429).json({
        error: `Active leads limit reached (${limitCheck.used}/${limitCheck.limit}). Convert or archive existing leads, or upgrade your plan.`,
        code: 'LEADS_LIMIT_REACHED',
        used: limitCheck.used,
        limit: limitCheck.limit,
      });
      return;
    }

    const result = await pool.query(
      `INSERT INTO leads
         (institute_id, student_name, student_phone, message, status, notes, follow_up_date, last_activity_at)
       VALUES ($1, $2, $3, $4, 'new', $5, $6, NOW())
       RETURNING *`,
      [
        institute_id,
        student_name?.trim() || null,
        student_phone.trim(),
        message?.trim() || '',
        notes?.trim() || null,
        follow_up_date || null,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create lead error:', err);
    res.status(500).json({ error: 'Failed to create lead.' });
  }
});

// ── PATCH /api/leads/:id/status ──────────────────────────────────────────────

router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body as { status?: string };

  if (!status || !['new', 'contacted', 'converted', 'lost'].includes(status)) {
    res.status(400).json({ error: 'Valid status is required.' });
    return;
  }

  try {
    const updateResult = await pool.query(
      `UPDATE leads SET status = $1, last_activity_at = NOW() WHERE id = $2`,
      [status, Number(id)],
    );
    if ((updateResult.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }

    // Auto-add to blocklist when marked as Lost
    if (status === 'lost') {
      const leadResult = await pool.query(
        `SELECT institute_id, student_phone, student_name FROM leads WHERE id = $1`,
        [Number(id)],
      );
      const lead = leadResult.rows[0];
      if (lead) {
        const reason = `Marked as lost${lead.student_name ? ` — ${lead.student_name as string}` : ''}`;
        void addToBlocklist(lead.institute_id as number, lead.student_phone as string, reason);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Failed to update status.' });
  }
});

// ── PATCH /api/leads/:id/notes ───────────────────────────────────────────────

router.patch('/:id/notes', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body as { notes?: string };

  try {
    await ensureLeadColumns();
    await pool.query(
      `UPDATE leads SET notes = $1, last_activity_at = NOW() WHERE id = $2`,
      [notes?.trim() ?? null, Number(id)],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update notes error:', err);
    res.status(500).json({ error: 'Failed to update notes.' });
  }
});

// ── PATCH /api/leads/:id/followup ────────────────────────────────────────────

router.patch('/:id/followup', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { follow_up_date } = req.body as { follow_up_date?: string | null };

  try {
    await ensureLeadColumns();
    await pool.query(
      `UPDATE leads SET follow_up_date = $1, last_activity_at = NOW() WHERE id = $2`,
      [follow_up_date ?? null, Number(id)],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update follow-up error:', err);
    res.status(500).json({ error: 'Failed to update follow-up date.' });
  }
});

// ── POST /api/leads/:id/send-followup ────────────────────────────────────────
// Generates an AI follow-up message and sends it via WhatsApp.

router.post('/:id/send-followup', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // Fetch lead details
    const leadResult = await pool.query(
      `SELECT l.*, i.name AS institute_name, i.id AS institute_id
       FROM leads l
       JOIN institutes i ON i.id = l.institute_id
       WHERE l.id = $1`,
      [Number(id)],
    );
    const lead = leadResult.rows[0];
    if (!lead) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }

    // Fetch institute details for context
    const detailsResult = await pool.query(
      `SELECT institute_data FROM institute_details WHERE institute_id = $1`,
      [lead.institute_id],
    );
    const instituteData: string | null = detailsResult.rows[0]?.institute_data ?? null;

    // Fetch last few messages for context
    const sessionId = `wa-${lead.institute_id}-${lead.student_phone}`;
    const historyResult = await pool.query(
      `SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 6`,
      [sessionId],
    );
    const recentHistory = historyResult.rows.reverse();
    const historyText = recentHistory.length > 0
      ? recentHistory.map((m: { role: string; content: string }) => `${m.role === 'user' ? 'Student' : 'AI'}: ${m.content}`).join('\n')
      : 'No previous conversation.';

    const studentName = lead.student_name ? `named ${lead.student_name}` : '';
    const contextSection = instituteData
      ? `Institute info:\n${instituteData.slice(0, 800)}`
      : `Institute: ${lead.institute_name as string}`;

    const prompt =
      `You are a follow-up assistant for ${lead.institute_name as string}. ` +
      `Write a short, warm WhatsApp follow-up message to a student ${studentName} ` +
      `who previously enquired about admissions but hasn't responded recently.\n\n` +
      `${contextSection}\n\n` +
      `Recent conversation:\n${historyText}\n\n` +
      `Guidelines:\n` +
      `- Keep it under 3 sentences\n` +
      `- Be warm and not pushy\n` +
      `- Reference their previous enquiry if context is available\n` +
      `- End with an open question to re-engage them\n` +
      `- Plain text only, no markdown`;

    // Generate follow-up message via Groq
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    });

    const followUpMessage = completion.choices[0]?.message?.content?.trim() || 
      `Hi! We noticed your enquiry about ${lead.institute_name as string}. We'd love to help you with your admission process. Are you still interested?`;

    const sent = await sendMessageToStudent(
      String(lead.institute_id),
      `${lead.student_phone as string}@c.us`,
      followUpMessage,
    );

    if (!sent) {
      res.status(503).json({ error: 'WhatsApp is not connected for this institute. Please connect WhatsApp first.' });
      return;
    }

    // Save follow-up message to conversation history
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'assistant', followUpMessage],
    );

    // Update lead last_activity_at
    await pool.query(
      `UPDATE leads SET last_activity_at = NOW() WHERE id = $1`,
      [Number(id)],
    );

    res.json({ success: true, message: followUpMessage });
  } catch (err) {
    console.error('Send follow-up error:', err);
    res.status(500).json({ error: 'Failed to send follow-up message.' });
  }
});

// ── GET /api/leads/:id/conversation ─────────────────────────────────────────
// Returns full conversation history for a lead from the messages table.

router.get('/:id/conversation', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Get lead to find institute_id and student_phone
    const leadResult = await pool.query(
      `SELECT institute_id, student_phone FROM leads WHERE id = $1`,
      [Number(id)],
    );
    const lead = leadResult.rows[0];
    if (!lead) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }

    const sessionId = `wa-${lead.institute_id}-${lead.student_phone}`;
    const result = await pool.query(
      `SELECT role, content, created_at
       FROM messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Conversation fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch conversation.' });
  }
});

// ── Export helper for whatsappManager to create leads with name extraction ───

export async function createLeadFromWhatsApp(
  instituteId: number,
  studentPhone: string,
  message: string,
): Promise<void> {
  try {
    await ensureLeadColumns();

    // Check if lead already exists for this phone + institute
    const existing = await pool.query(
      `SELECT id, student_name FROM leads WHERE institute_id = $1 AND student_phone = $2 LIMIT 1`,
      [instituteId, studentPhone],
    );

    if (existing.rows.length > 0) {
      // Lead exists — just update last_activity_at (doesn't count toward limit)
      await pool.query(
        `UPDATE leads SET last_activity_at = NOW(), message = $1 WHERE id = $2`,
        [message, existing.rows[0].id],
      );
      return;
    }

    // New lead — check active leads limit before inserting
    const plan = await getInstitutePlan(instituteId);
    const limitCheck = await checkActiveleadsLimit(instituteId, plan);
    if (!limitCheck.allowed) {
      console.log(`[Leads] Institute ${instituteId} hit active leads cap (${limitCheck.used}/${limitCheck.limit}) — lead not saved for ${studentPhone}`);
      return; // Silently skip — AI will still reply, just won't save as lead
    }

    // New lead — try to extract name from first message
    const studentName = await extractStudentName(message);

    await pool.query(
      `INSERT INTO leads (institute_id, student_name, student_phone, message, status, last_activity_at)
       VALUES ($1, $2, $3, $4, 'new', NOW())`,
      [instituteId, studentName, studentPhone, message],
    );
  } catch (err) {
    console.error(`[Leads] Failed to create lead for institute ${instituteId}:`, err);
  }
}

export default router;