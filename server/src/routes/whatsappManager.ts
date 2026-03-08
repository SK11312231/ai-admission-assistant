import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import OpenAI from 'openai';
import pool from '../db';

// ── Types ────────────────────────────────────────────────────────────────────

export type WAStatus = 'initializing' | 'qr' | 'connected' | 'disconnected';

interface SessionState {
  client: Client;
  qr: string | null;
  status: WAStatus;
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

// ── In-memory session store (keyed by instituteId as string) ─────────────────

const sessions = new Map<string, SessionState>();

// ── Lazy OpenAI/Groq client (same as chat.ts) ────────────────────────────────

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

// ── Build system prompt (same as chat.ts) ────────────────────────────────────

async function buildSystemPrompt(): Promise<string> {
  const result = await pool.query('SELECT * FROM universities ORDER BY ranking ASC');
  const universities = result.rows as University[];

  const uniList = universities
    .map((u) => {
      const programs = JSON.parse(u.programs) as string[];
      return (
        `- **${u.name}** (Ranking: #${u.ranking}, Location: ${u.location}, ` +
        `Acceptance Rate: ${u.acceptance_rate}%)\n` +
        `  Programs: ${programs.join(', ')}\n` +
        `  ${u.description}`
      );
    })
    .join('\n\n');

  return (
    `You are an expert AI college admission counselor. Your goal is to help prospective students ` +
    `understand their options, navigate the admission process, and find universities that match their goals.\n\n` +
    `You have access to the following university database:\n\n` +
    `${uniList}\n\n` +
    `Guidelines:\n` +
    `- Be warm, encouraging, and professional.\n` +
    `- Provide specific, accurate information based on the data above.\n` +
    `- When recommending universities, consider the student's interests and goals.\n` +
    `- If asked about something outside the provided data, be honest about limitations.\n` +
    `- Keep responses concise but helpful (2–4 paragraphs max).\n` +
    `- You are replying via WhatsApp, so avoid markdown formatting like ** or ##. Use plain text only.`
  );
}

// ── Save incoming message + generate AI reply ────────────────────────────────
// Uses the student's phone number as the session ID so conversation history
// is preserved across messages, exactly like the web chat flow.

async function getAIReply(
  instituteId: number,
  studentPhone: string,
  messageText: string,
): Promise<string | null> {
  try {
    // Use "wa-{instituteId}-{studentPhone}" as a unique session ID
    const sessionId = `wa-${instituteId}-${studentPhone}`;

    // Persist the student's message
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', messageText.trim()],
    );

    // Retrieve last 20 messages for context (same as chat.ts)
    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
      [sessionId],
    );
    const history = historyResult.rows as MessageRow[];

    // Call Groq with same model + settings as chat.ts
    const client = getOpenAI();
    const systemPrompt = await buildSystemPrompt();
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const reply = completion.choices[0]?.message?.content ?? 'Sorry, I could not generate a response.';

    // Persist the assistant reply
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'assistant', reply],
    );

    return reply;
  } catch (err) {
    console.error(`[WA] AI reply error for institute ${instituteId}:`, err);
    return null;
  }
}

// ── Save lead to DB ──────────────────────────────────────────────────────────

async function saveLead(instituteId: number, studentPhone: string, message: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO leads (institute_id, student_phone, message, status)
       VALUES ($1, $2, $3, 'new')
       ON CONFLICT DO NOTHING`,
      [instituteId, studentPhone, message],
    );
  } catch (err) {
    console.error(`[WA] Failed to save lead for institute ${instituteId}:`, err);
  }
}

// ── Puppeteer client factory ─────────────────────────────────────────────────

function makeClient(instituteId: string): Client {
  return new Client({
    authStrategy: new LocalAuth({ clientId: `institute-${instituteId}` }),
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
    },
  });
}

// ── Core: init or resume a session ──────────────────────────────────────────

export async function initSession(instituteId: string): Promise<void> {
  const existing = sessions.get(instituteId);
  if (existing?.status === 'connected') return;
  if (existing?.status === 'initializing' || existing?.status === 'qr') return;

  console.log(`[WA] Initializing session for institute ${instituteId}`);

  const client = makeClient(instituteId);
  const state: SessionState = { client, qr: null, status: 'initializing' };
  sessions.set(instituteId, state);

  client.on('qr', (qr) => {
    console.log(`[WA] QR received for institute ${instituteId}`);
    state.qr = qr;
    state.status = 'qr';
  });

  client.on('ready', async () => {
    console.log(`[WA] Client ready for institute ${instituteId}`);
    state.qr = null;
    state.status = 'connected';
    await pool.query(`UPDATE institutes SET whatsapp_connected = TRUE WHERE id = $1`, [Number(instituteId)]);
  });

  client.on('disconnected', async (reason) => {
    console.log(`[WA] Disconnected for institute ${instituteId}: ${reason}`);
    state.status = 'disconnected';
    await pool.query(`UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`, [Number(instituteId)]);
  });

  client.on('auth_failure', (msg) => {
    console.error(`[WA] Auth failure for institute ${instituteId}:`, msg);
    state.status = 'disconnected';
  });

  // ── Handle incoming student messages ──────────────────────────────────────
  client.on('message', async (msg: Message) => {
    // ✅ New - check group by the @g.us suffix instead
    if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast' || msg.fromMe) return;

    const studentPhone = msg.from.replace('@c.us', '');
    const messageText = msg.body;

    console.log(`[WA] Message for institute ${instituteId} from ${studentPhone}: ${messageText}`);

    // Save lead first (non-blocking result)
    await saveLead(Number(instituteId), studentPhone, messageText);

    // Generate AI reply using same Groq pipeline as chat.ts
    const reply = await getAIReply(Number(instituteId), studentPhone, messageText);
    if (!reply) {
      console.warn(`[WA] No AI reply generated for institute ${instituteId}`);
      return;
    }

    // Send reply back on WhatsApp
    try {
      await msg.reply(reply);
      console.log(`[WA] Reply sent to ${studentPhone} for institute ${instituteId}`);
    } catch (err) {
      console.error(`[WA] Failed to send reply:`, err);
    }
  });

  await client.initialize();
}

// ── Get current session state (for polling endpoint) ────────────────────────

export function getSessionState(instituteId: string): { status: WAStatus; qr: string | null } {
  const state = sessions.get(instituteId);
  if (!state) return { status: 'disconnected', qr: null };
  return { status: state.status, qr: state.qr };
}

// ── Disconnect a session ─────────────────────────────────────────────────────

export async function disconnectSession(instituteId: string): Promise<void> {
  const state = sessions.get(instituteId);
  if (!state) return;
  try {
    await state.client.destroy();
  } catch (err) {
    console.error(`[WA] Error destroying client for institute ${instituteId}:`, err);
  }
  sessions.delete(instituteId);
  await pool.query(`UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`, [Number(instituteId)]);
}

// ── On server start: restore sessions for already-connected institutes ───────

export async function restoreAllSessions(): Promise<void> {
  try {
    const result = await pool.query(`SELECT id FROM institutes WHERE whatsapp_connected = TRUE`);
    const ids: number[] = result.rows.map((r: { id: number }) => r.id);
    console.log(`[WA] Restoring ${ids.length} WhatsApp session(s)...`);
    for (const id of ids) {
      void initSession(String(id));
    }
  } catch (err) {
    console.error('[WA] Failed to restore sessions:', err);
  }
}
