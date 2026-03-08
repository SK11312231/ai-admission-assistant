// At top of file, add this constant
const WA_DATA_PATH = '/tmp/wwebjs_auth';
import { Client, RemoteAuth, Message } from 'whatsapp-web.js';
import OpenAI from 'openai';
import pool from '../db';
import { getInstituteDetails } from './instituteEnrichment';
import { Pool } from 'pg';


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

// ── PostgreSQL RemoteAuth Store ──────────────────────────────────────────────
// Implements the interface whatsapp-web.js RemoteAuth expects.
// Stores the zipped session as base64 in a DB table.

class PostgresStore {
  private pool: Pool;

  constructor(pgPool: Pool) {
    this.pool = pgPool;
  }

  async sessionExists(options: { session: string }): Promise<boolean> {
    await this.ensureTable();
    const result = await this.pool.query(
      `SELECT 1 FROM whatsapp_sessions WHERE session_id = $1`,
      [options.session],
    );
    return result.rows.length > 0;
  }

  async save(options: { session: string }): Promise<void> {
    await this.ensureTable();
    // whatsapp-web.js saves session zip to /tmp/{session}.zip — read and store as base64
    const fs = await import('fs/promises');
    const path = await import('path');
    const zipPath = path.join(WA_DATA_PATH, `${options.session}.zip`); 
    try {
      const data = await fs.readFile(zipPath);
      const base64 = data.toString('base64');
      await this.pool.query(
        `INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (session_id)
         DO UPDATE SET session_data = EXCLUDED.session_data, updated_at = NOW()`,
        [options.session, base64],
      );
      console.log(`[WA Store] Session saved: ${options.session}`);
    } catch (err) {
      console.error(`[WA Store] Failed to save session ${options.session}:`, err);
    }
  }

  async extract(options: { session: string, path: string }): Promise<void> {
    await this.ensureTable();
    const result = await this.pool.query(
      `SELECT session_data FROM whatsapp_sessions WHERE session_id = $1`,
      [options.session],
    );
    if (result.rows.length === 0) {
      console.log(`[WA Store] No session found for ${options.session}`);
      return;
    }
    const fs = await import('fs/promises');
    const path = await import('path');
    const base64 = result.rows[0].session_data as string;
    const zipPath = path.join(WA_DATA_PATH, `${options.session}.zip`);
    await fs.writeFile(zipPath, Buffer.from(base64, 'base64'));
    console.log(`[WA Store] Session extracted: ${options.session} → ${zipPath}`);
  }

  async delete(options: { session: string }): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `DELETE FROM whatsapp_sessions WHERE session_id = $1`,
      [options.session],
    );
    console.log(`[WA Store] Session deleted: ${options.session}`);
  }

  private async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        session_id   TEXT PRIMARY KEY,
        session_data TEXT NOT NULL,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }
}

// Single shared store instance
let store: PostgresStore | null = null;
function getStore(): PostgresStore {
  if (!store) store = new PostgresStore(pool);
  return store;
}

// ── Save lead ────────────────────────────────────────────────────────────────

async function saveLead(
  instituteId: number,
  studentPhone: string,
  message: string,
): Promise<void> {
  try {
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW()`);

    const existing = await pool.query(
      `SELECT id FROM leads WHERE institute_id = $1 AND student_phone = $2 LIMIT 1`,
      [instituteId, studentPhone],
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE leads SET last_activity_at = NOW(), message = $1 WHERE id = $2`,
        [message, existing.rows[0].id],
      );
    } else {
      let studentName: string | null = null;
      try {
        const client = getOpenAI();
        const completion = await client.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'Extract the student name from the message. Reply with ONLY the name, or NULL if not found.' },
            { role: 'user', content: message },
          ],
          temperature: 0,
          max_tokens: 20,
        });
        const raw = completion.choices[0]?.message?.content?.trim() ?? 'NULL';
        studentName = raw === 'NULL' || raw === '' ? null : raw;
      } catch { /* non-fatal */ }

      await pool.query(
        `INSERT INTO leads (institute_id, student_name, student_phone, message, status, last_activity_at)
         VALUES ($1, $2, $3, $4, 'new', NOW())`,
        [instituteId, studentName, studentPhone, message],
      );
      console.log(`[WA] New lead: ${studentPhone}, name: ${studentName ?? 'unknown'}`);
    }
  } catch (err) {
    console.error(`[WA] saveLead failed (non-fatal):`, err);
  }
}

// ── Build system prompt ──────────────────────────────────────────────────────

async function buildSystemPrompt(instituteId: number): Promise<string> {
  try {
    const instResult = await pool.query('SELECT name FROM institutes WHERE id = $1', [instituteId]);
    const instituteName: string = instResult.rows[0]?.name ?? 'this institute';
    let instituteData: string | null = null;
    try { instituteData = await getInstituteDetails(instituteId); } catch { /* non-fatal */ }

    const contextSection = instituteData
      ? `You have the following detailed information about ${instituteName}:\n\n${instituteData}`
      : `You are representing ${instituteName}. Detailed profile information is not yet available.`;

    return (
      `You are an AI admission assistant for ${instituteName}. ` +
      `Your job is to help prospective students with admission enquiries, course information, fees, eligibility, and placements.\n\n` +
      `${contextSection}\n\n` +
      `Guidelines:\n` +
      `- Be warm, encouraging, and professional.\n` +
      `- Answer based on the institute information provided above.\n` +
      `- If a question is outside the available information, say so honestly.\n` +
      `- Keep responses concise and helpful (2-3 paragraphs max).\n` +
      `- You are replying via WhatsApp — use plain text only, no markdown.\n` +
      `- Never make up fees, dates, or facts not present in the institute data.`
    );
  } catch (err) {
    console.error(`[WA] buildSystemPrompt failed:`, err);
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

    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', messageText.trim()],
    );

    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
      [sessionId],
    );
    const history = historyResult.rows as MessageRow[];
    console.log(`[WA] History: ${history.length} messages`);

    const systemPrompt = await buildSystemPrompt(instituteId);
    console.log(`[WA] Calling Groq...`);

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
    console.log(`[WA] Groq reply received (${reply.length} chars)`);

    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'assistant', reply],
    );

    return reply;
  } catch (err) {
    console.error(`[WA] getAIReply FAILED:`, err);
    return null;
  }
}

// ── Puppeteer client factory with RemoteAuth ─────────────────────────────────

function makeClient(instituteId: string): Client {
  return new Client({
    authStrategy: new RemoteAuth({
      clientId: `institute-${instituteId}`,
      store: getStore(),
      dataPath: WA_DATA_PATH,
      backupSyncIntervalMs: 300_000, // save session every 5 minutes
    }),
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
    console.log(`[WA] Client READY for institute ${instituteId}`);
    state.qr = null;
    state.status = 'connected';
    await pool.query(`UPDATE institutes SET whatsapp_connected = TRUE WHERE id = $1`, [Number(instituteId)]);
  });

  client.on('remote_session_saved', () => {
    console.log(`[WA] Session saved to DB for institute ${instituteId}`);
  });

  client.on('disconnected', async (reason) => {
    console.log(`[WA] Disconnected institute ${instituteId}: ${reason}`);
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
    console.log(`[WA] Institute: ${instituteId} | From: ${studentPhone}`);
    console.log(`[WA] Text: ${messageText}`);

    // Save lead in background — never blocks reply
    void saveLead(Number(instituteId), studentPhone, messageText);

    try {
      console.log(`[WA] Calling getAIReply...`);
      const reply = await getAIReply(Number(instituteId), studentPhone, messageText);
      console.log(`[WA] getAIReply returned: ${reply ? reply.slice(0, 50) : 'NULL'}`);  // ← add this
      if (!reply) {
        console.error(`[WA] No reply generated`);
        return;
      }
      await client.sendMessage(msg.from, reply);
      console.log(`[WA] ===== REPLY SENT =====`);
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
