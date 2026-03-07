import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import pool from '../db';

const router = Router();

interface InstituteRow {
  id: number;
  name: string;
  whatsapp_number: string;
  plan: string;
}

interface University {
  id: number;
  name: string;
  location: string;
  ranking: number;
  acceptance_rate: number;
  programs: string;
  description: string;
}

interface MessageRow {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * WhatsApp Cloud API webhook handler.
 *
 * To enable this integration the institute owner must:
 *   1. Set up a Meta Business App with WhatsApp Business API access.
 *   2. Register the business phone number in Meta → WhatsApp → API Setup.
 *   3. Configure a webhook pointing to:
 *        https://<your-railway-domain>/api/webhook/whatsapp
 *      with these subscribed fields: messages
 *   4. Add the following environment variables in Railway:
 *        WHATSAPP_VERIFY_TOKEN   — a custom string you choose; put the same string in Meta webhook config
 *        WHATSAPP_API_TOKEN      — the permanent system user access token from Meta
 *        GROQ_API_KEY            — your Groq API key for AI-powered replies (free at console.groq.com)
 */

// ── OpenAI helper ──────────────────────────────────────────────────────────

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not set.');
    }
    openai = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return openai;
}

/**
 * Build a system prompt personalised for the specific institute.
 * Includes university data from the DB so the AI can recommend options.
 */
async function buildInstituteSystemPrompt(institute: InstituteRow): Promise<string> {
  const uniResult = await pool.query(
    'SELECT id, name, location, ranking, acceptance_rate, programs, description FROM universities ORDER BY ranking ASC',
  );
  const universities = uniResult.rows as University[];

  const uniList = universities
    .map((u) => {
      let programs: string[] = [];
      try { programs = JSON.parse(u.programs) as string[]; } catch { programs = [u.programs]; }
      return (
        `- ${u.name} (Ranking: #${u.ranking}, Location: ${u.location}, ` +
        `Acceptance Rate: ${u.acceptance_rate}%)\n` +
        `  Programs: ${programs.join(', ')}\n` +
        `  ${u.description}`
      );
    })
    .join('\n\n');

  return (
    `You are an AI admission counselor representing ${institute.name}. ` +
    `Your job is to warmly assist prospective students who have messaged this institute on WhatsApp.\n\n` +
    `Your goals:\n` +
    `- Answer the student's question accurately and helpfully.\n` +
    `- Be warm, encouraging, and professional.\n` +
    `- If relevant, recommend universities from the catalog below that match their interests.\n` +
    `- Keep replies concise — 2–4 short paragraphs. WhatsApp messages should be easy to read on mobile.\n` +
    `- Do NOT use markdown formatting (no **bold**, no bullet lists with dashes). Use plain text only.\n` +
    `- If the student asks something you cannot answer, invite them to call the institute directly.\n\n` +
    `University catalog:\n\n${uniList}`
  );
}

/**
 * Generate an AI reply for the student using conversation history.
 * Falls back to a friendly static message if OpenAI is unavailable.
 */
async function generateAIReply(
  institute: InstituteRow,
  studentPhone: string,
  studentMessage: string,
): Promise<string> {
  const sessionId = `whatsapp-${studentPhone}-${institute.id}`;

  // Retrieve the most recent 10 messages for context window, in chronological order
  const historyResult = await pool.query(
    `SELECT role, content FROM (
       SELECT role, content, created_at FROM messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 10
     ) sub
     ORDER BY created_at ASC`,
    [sessionId],
  );
  const history = historyResult.rows as MessageRow[];

  // Persist the incoming student message
  await pool.query(
    'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
    [sessionId, 'user', studentMessage],
  );

  const client = getOpenAI();
  const systemPrompt = await buildInstituteSystemPrompt(institute);

  const completion = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: studentMessage },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  const reply =
    completion.choices[0]?.message?.content?.trim() ??
    `Thank you for reaching out to ${institute.name}! We have received your message and will get back to you shortly.`;

  // Persist the AI reply
  await pool.query(
    'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
    [sessionId, 'assistant', reply],
  );

  return reply;
}

// ── WhatsApp Cloud API helper ──────────────────────────────────────────────

async function sendWhatsAppMessage(
  phoneNumberId: string,
  toPhone: string,
  text: string,
): Promise<void> {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  if (!apiToken) {
    console.warn('WHATSAPP_API_TOKEN is not set — skipping send.');
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: text },
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`WhatsApp send failed (${res.status}): ${errBody}`);
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/webhook/whatsapp — Meta webhook verification (challenge handshake)
router.get('/whatsapp', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode']         as string | undefined;
  const token     = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge']    as string | undefined;

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified.');
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

// POST /api/webhook/whatsapp — receive incoming WhatsApp messages
router.post('/whatsapp', async (req: Request, res: Response) => {
  // Always respond 200 immediately so Meta doesn't retry
  res.sendStatus(200);

  try {
    const body = req.body as Record<string, unknown>;

    const entry    = (body.entry as Array<Record<string, unknown>> | undefined)?.[0];
    const changes  = (entry?.changes as Array<Record<string, unknown>> | undefined)?.[0];
    const value    = changes?.value as Record<string, unknown> | undefined;
    const messages = value?.messages as Array<Record<string, unknown>> | undefined;
    const metadata = value?.metadata as Record<string, unknown> | undefined;

    if (!messages || messages.length === 0) {
      // Status update or other non-message event — nothing to do
      return;
    }

    const incomingMsg = messages[0];

    // Ignore non-actionable event types (status updates, reactions, etc.)
    const msgType = incomingMsg.type as string;
    if (msgType === 'status' || msgType === 'reaction') return;

    const studentPhone = incomingMsg.from as string;
    const studentName  = (
      (value?.contacts as Array<Record<string, unknown>> | undefined)?.[0]
        ?.profile as Record<string, unknown> | undefined
    )?.name as string | undefined;

    // Support text messages; treat other types (image, audio, etc.) as a generic message
    const messageBody: string =
      (incomingMsg.text as Record<string, unknown> | undefined)?.body as string ||
      `[${msgType ?? 'unknown'} message received]`;

    const businessPhoneId = metadata?.phone_number_id as string | undefined;
    const displayPhone    = metadata?.display_phone_number as string | undefined;

    // Match the receiving WhatsApp number to a registered institute
    let institute: InstituteRow | undefined;
    if (displayPhone) {
      const normalized = displayPhone.replace(/\D/g, '');
      const result = await pool.query(
        `SELECT id, name, whatsapp_number, plan FROM institutes
         WHERE REGEXP_REPLACE(whatsapp_number, '[^0-9]', '', 'g') = $1`,
        [normalized],
      );
      institute = result.rows[0] as InstituteRow | undefined;
    }

    if (!institute) {
      console.warn(`No institute matched WhatsApp number: ${displayPhone ?? 'unknown'}`);
      return;
    }

    // 1. Create a lead for this student inquiry
    await pool.query(
      `INSERT INTO leads (institute_id, student_name, student_phone, message)
       VALUES ($1, $2, $3, $4)`,
      [institute.id, studentName ?? null, studentPhone, messageBody],
    );
    console.log(`✅ Lead created for institute ${institute.id} from ${studentPhone}`);

    // 2. Generate an AI reply and send it back on WhatsApp
    if (businessPhoneId && process.env.WHATSAPP_API_TOKEN) {
      try {
        const replyText = await generateAIReply(institute, studentPhone, messageBody);
        await sendWhatsAppMessage(businessPhoneId, studentPhone, replyText);
        console.log(`✅ AI reply sent to ${studentPhone}`);
      } catch (aiErr) {
        console.error('AI reply failed, sending fallback:', aiErr);
        // Fallback: send a static message so the student isn't left hanging
        const fallback =
          `Hi! Thank you for contacting ${institute.name}. ` +
          `We have received your message and will get back to you shortly.`;
        await sendWhatsAppMessage(businessPhoneId, studentPhone, fallback).catch(console.error);
      }
    } else {
      console.warn(
        'WHATSAPP_API_TOKEN or phone_number_id missing — lead saved, but no reply sent.',
      );
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    // res.sendStatus(200) was already sent above
  }
});

export default router;
