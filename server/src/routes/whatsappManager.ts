import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import OpenAI from 'openai';
import pool from '../db';
import { getInstituteDetails } from './instituteEnrichment';
import { createLeadFromWhatsApp } from './leads';

// ── Types ────────────────────────────────────────────────────────────────────

export type WAStatus = 'initializing' | 'qr' | 'connected' | 'disconnected';

interface SessionState {
  client: Client;
  qr: string | null;
  status: WAStatus;
}

interface MessageRow {
  role: 'user' | 'assistant';
  content: string;
}

// ── In-memory session store ──────────────────────────────────────────────────

const sessions = new Map<string, SessionState>();

// ── Lazy OpenAI/Groq client ──────────────────────────────────────────────────

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

// ── Build institute-specific system prompt ───────────────────────────────────

async function buildSystemPrompt(instituteId: number): Promise<string> {
  const instResult = await pool.query('SELECT name FROM institutes WHERE id = $1', [instituteId]);
  const instituteName: string = instResult.rows[0]?.name ?? 'this institute';
  const instituteData = await getInstituteDetails(instituteId);

  const contextSection = instituteData
    ? `You have the following detailed information about ${instituteName}:\n\n${instituteData}`
    : `You are representing ${instituteName}. Detailed profile information is not yet available. ` +
      `Answer general admission-related questions helpfully and let students know they can contact the institute directly for specific details.`;

  return (
    `You are an AI admission assistant for ${instituteName}. ` +
    `Your job is to help prospective students with admission enquiries, course information, fees, eligibility, and placements.\n\n` +
    `${contextSection}\n\n` +
    `Guidelines:\n` +
    `- Be warm, encouraging, and professional.\n` +
    `- Answer based on the institute information provided above.\n` +
    `- If a question is outside the available information, say so honestly and suggest the student contact the institute directly.\n` +
    `- Keep responses concise and helpful (2-3 paragraphs max).\n` +
    `- You are replying via WhatsApp — use plain text only, no markdown like ** or ##.\n` +
    `- Never make up fees, dates, or facts not present in the institute data.`
  );
}

// ── Generate AI reply ────────────────────────────────────────────────────────

async function getAIReply(
  instituteId: number,
  studentPhone: string,
  messageText: string,
): Promise<string | null> {
  try {
    const sessionId = `wa-${instituteId}-${studentPhone}`;

    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', messageText.trim()],
    );

    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
      [sessionId],
    );
    const history = historyResult.rows as MessageRow[];

    const systemPrompt = await buildSystemPrompt(instituteId);
    const client = getOpenAI();
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

// ── Init session ─────────────────────────────────────────────────────────────

export async function initSession(instituteId: string): Promise<void> {
  const existing = sessions.get(instituteId);
  if (existing?.status === 'connected') return;
  if (existing?.status === 'initializing' || existing?.status === 'qr') return;

  console.log(`[WA] Initializing session for institute ${instituteId}`);
  const client = makeClient(instituteId);
  const state: SessionState = { client, qr: null, status: 'initializing' };
  sessions.set(instituteId, state);

  client.on('qr', (qr) => {
    state.qr = qr;
    state.status = 'qr';
  });

  client.on('ready', async () => {
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

  client.on('message', async (msg: Message) => {
    if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast' || msg.fromMe) return;

    const studentPhone = msg.from.replace('@c.us', '');
    const messageText = msg.body;

    console.log(`[WA] Message for institute ${instituteId} from ${studentPhone}`);

    // Create/update lead with name extraction
    await createLeadFromWhatsApp(Number(instituteId), studentPhone, messageText);

    const reply = await getAIReply(Number(instituteId), studentPhone, messageText);
    if (!reply) return;

    try {
      await msg.reply(reply);
    } catch (err) {
      console.error(`[WA] Failed to send reply:`, err);
    }
  });

  await client.initialize();
}

// ── Exports ──────────────────────────────────────────────────────────────────

export function getSessionState(instituteId: string): { status: WAStatus; qr: string | null } {
  const state = sessions.get(instituteId);
  if (!state) return { status: 'disconnected', qr: null };
  return { status: state.status, qr: state.qr };
}

export async function disconnectSession(instituteId: string): Promise<void> {
  const state = sessions.get(instituteId);
  if (!state) return;
  try { await state.client.destroy(); } catch { /* ignore */ }
  sessions.delete(instituteId);
  await pool.query(`UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`, [Number(instituteId)]);
}

export async function restoreAllSessions(): Promise<void> {
  try {
    const result = await pool.query(`SELECT id FROM institutes WHERE whatsapp_connected = TRUE`);
    const ids: number[] = result.rows.map((r: { id: number }) => r.id);
    console.log(`[WA] Restoring ${ids.length} WhatsApp session(s)...`);
    for (const id of ids) void initSession(String(id));
  } catch (err) {
    console.error('[WA] Failed to restore sessions:', err);
  }
}
