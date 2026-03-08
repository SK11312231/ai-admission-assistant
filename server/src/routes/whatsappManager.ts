import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import OpenAI from 'openai';
import pool from '../db';
import { getInstituteDetails } from './instituteEnrichment';

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

// ── Save lead (self-contained, no external imports to avoid any dep issues) ──

async function saveLead(
  instituteId: number,
  studentPhone: string,
  message: string,
): Promise<void> {
  try {
    // Ensure columns exist
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW()`);

    // Check if lead already exists
    const existing = await pool.query(
      `SELECT id FROM leads WHERE institute_id = $1 AND student_phone = $2 LIMIT 1`,
      [instituteId, studentPhone],
    );

    if (existing.rows.length > 0) {
      // Update last activity and latest message
      await pool.query(
        `UPDATE leads SET last_activity_at = NOW(), message = $1 WHERE id = $2`,
        [message, existing.rows[0].id],
      );
      console.log(`[WA] Lead updated for ${studentPhone}`);
    } else {
      // Insert new lead — try name extraction but don't block on it
      let studentName: string | null = null;
      try {
        const client = getOpenAI();
        const completion = await client.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'Extract the student name from the message. Reply with ONLY the name, or NULL if not found.',
            },
            { role: 'user', content: message },
          ],
          temperature: 0,
          max_tokens: 20,
        });
        const raw = completion.choices[0]?.message?.content?.trim() ?? 'NULL';
        studentName = raw === 'NULL' || raw === '' ? null : raw;
      } catch (nameErr) {
        console.warn(`[WA] Name extraction failed (non-fatal):`, nameErr);
      }

      await pool.query(
        `INSERT INTO leads (institute_id, student_name, student_phone, message, status, last_activity_at)
         VALUES ($1, $2, $3, $4, 'new', NOW())`,
        [instituteId, studentName, studentPhone, message],
      );
      console.log(`[WA] New lead created for ${studentPhone}, name: ${studentName ?? 'unknown'}`);
    }
  } catch (err) {
    // Completely non-fatal — log and move on
    console.error(`[WA] saveLead failed (non-fatal):`, err);
  }
}

// ── Build institute-specific system prompt ───────────────────────────────────

async function buildSystemPrompt(instituteId: number): Promise<string> {
  console.log(`[WA] Building system prompt for institute ${instituteId}`);
  try {
    const instResult = await pool.query('SELECT name FROM institutes WHERE id = $1', [instituteId]);
    const instituteName: string = instResult.rows[0]?.name ?? 'this institute';
    console.log(`[WA] Institute name: ${instituteName}`);

    let instituteData: string | null = null;
    try {
      instituteData = await getInstituteDetails(instituteId);
      console.log(`[WA] Institute details loaded: ${instituteData ? 'yes' : 'none'}`);
    } catch (detailErr) {
      console.warn(`[WA] Could not load institute details (non-fatal):`, detailErr);
    }

    const contextSection = instituteData
      ? `You have the following detailed information about ${instituteName}:\n\n${instituteData}`
      : `You are representing ${instituteName}. Detailed profile information is not yet available. ` +
        `Answer general admission-related questions helpfully.`;

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
  } catch (err) {
    console.error(`[WA] buildSystemPrompt failed:`, err);
    // Absolute fallback — never let a prompt error kill the reply
    return `You are a helpful AI admission assistant. Answer student questions about admissions warmly and concisely in plain text.`;
  }
}

// ── Generate AI reply ────────────────────────────────────────────────────────

async function getAIReply(
  instituteId: number,
  studentPhone: string,
  messageText: string,
): Promise<string | null> {
  console.log(`[WA] getAIReply START — institute ${instituteId}, phone ${studentPhone}`);

  try {
    const sessionId = `wa-${instituteId}-${studentPhone}`;

    // Step 1: Save user message to history
    console.log(`[WA] Saving user message to history, sessionId: ${sessionId}`);
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', messageText.trim()],
    );
    console.log(`[WA] User message saved`);

    // Step 2: Load conversation history
    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
      [sessionId],
    );
    const history = historyResult.rows as MessageRow[];
    console.log(`[WA] History loaded: ${history.length} messages`);

    // Step 3: Build system prompt
    const systemPrompt = await buildSystemPrompt(instituteId);
    console.log(`[WA] System prompt ready (length: ${systemPrompt.length})`);

    // Step 4: Call Groq
    console.log(`[WA] Calling Groq API...`);
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
    console.log(`[WA] Groq reply received (length: ${reply.length})`);

    // Step 5: Save assistant reply to history
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'assistant', reply],
    );
    console.log(`[WA] Assistant reply saved to history`);

    return reply;
  } catch (err) {
    console.error(`[WA] getAIReply FAILED for institute ${instituteId}:`, err);
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

  client.on('message', async (msg: Message) => {
    if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast' || msg.fromMe) return;

    const studentPhone = msg.from.replace('@c.us', '');
    const messageText = msg.body;

    console.log(`[WA] ===== INCOMING MESSAGE =====`);
    console.log(`[WA] Institute: ${instituteId}`);
    console.log(`[WA] From: ${studentPhone}`);
    console.log(`[WA] Text: ${messageText}`);

    // Save lead in background — never blocks the reply
    void saveLead(Number(instituteId), studentPhone, messageText);

    // Generate and send reply
    try {
      const reply = await getAIReply(Number(instituteId), studentPhone, messageText);
      if (!reply) {
        console.error(`[WA] No reply generated — getAIReply returned null`);
        return;
      }
      console.log(`[WA] Sending reply to ${studentPhone}...`);
      // ✅ New — use client.sendMessage directly
      await client.sendMessage(msg.from, reply);
      console.log(`[WA] ===== REPLY SENT SUCCESSFULLY =====`);
    } catch (err) {
      console.error(`[WA] CRITICAL: Failed to send reply:`, err);
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
