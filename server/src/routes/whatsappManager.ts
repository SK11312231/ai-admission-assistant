import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import OpenAI from 'openai';
import pool from '../db';
import { isNumberBlocked } from './blocklist';
import { getInstituteDetails, scrapeAndEnrich as scrapeAndEnrichFn } from './instituteEnrichment';
import { sendNewLeadEmail } from './emailService';
import { getPersonalityProfile, getRelevantExamples } from './chatTraining';

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
const initLocks = new Set<string>();

// ── GPT-4o-mini client ───────────────────────────────────────────────────────
// Switched from Groq/Llama to GPT-4o-mini:
//   1. No rate limit 429 errors — Groq free tier was throttling when multiple
//      students messaged simultaneously, causing the fallback loop bug
//   2. Single API call — classifier + reply merged into one call (half the usage)
//   3. Better instruction following for CLOSING/LOOP states
//   4. Better Hindi/Hinglish support for Indian students

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: 'https://api.openai.com/v1',
    });
  }
  return openai;
}

// ── Save lead ────────────────────────────────────────────────────────────────

const SPAM_PATTERNS = [
  /@lid$/,
  /@newsletter$/,
  /paymentredirect/i,
  /policybazaar/i,
  /insuremile/i,
  /type \*#\*/i,
  /restart your journey/i,
];

function isSpam(phone: string, message: string): boolean {
  if (SPAM_PATTERNS.some(p => p.test(phone))) return true;
  if (SPAM_PATTERNS.some(p => p.test(message))) return true;
  return /^https?:\/\/\S+$/.test(message.trim());
}

async function saveLead(
  instituteId: number,
  studentPhone: string,
  message: string,
): Promise<void> {
  try {
    if (isSpam(studentPhone, message)) {
      console.log(`[WA] Spam detected, skipping: ${studentPhone}`);
      return;
    }
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
      return;
    }

    // New lead — name extraction (runs after reply to avoid concurrent API calls)
    let studentName: string | null = null;
    try {
      const client = getOpenAI();
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
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

    void (async () => {
      try {
        const instResult = await pool.query('SELECT name, email FROM institutes WHERE id = $1', [instituteId]);
        const inst = instResult.rows[0];
        if (inst?.email) {
          await sendNewLeadEmail({
            toEmail: inst.email as string,
            instituteName: inst.name as string,
            studentName,
            studentPhone,
            message,
          });
        }
      } catch (err) {
        console.error('[WA] New lead email failed:', err);
      }
    })();
  } catch (err) {
    console.error(`[WA] saveLead failed:`, err);
  }
}

// ── Build system prompt (single-call architecture) ───────────────────────────
//
// The prompt asks GPT-4o-mini to:
//   1. Detect the conversation state from the history
//   2. Follow the matching state instruction
//   3. Output: first line = "STATE: X", remaining lines = the reply
//
// This replaces the previous two-call architecture (classifier + reply).
// One call = no race conditions, no rate limit issues from concurrent calls.

async function buildSystemPrompt(
  instituteId: number,
  studentMessage: string,
  recentHistory: MessageRow[],
): Promise<string> {
  try {
    const instResult = await pool.query(
      'SELECT name, website FROM institutes WHERE id = $1',
      [instituteId],
    );
    const instituteName: string = instResult.rows[0]?.name ?? 'this institute';
    const website: string | null = instResult.rows[0]?.website ?? null;

    let instituteData: string | null = null;
    try { instituteData = await getInstituteDetails(instituteId); } catch { /* non-fatal */ }

    if (!instituteData) {
      console.log(`[WA] No details for institute ${instituteId} — triggering enrichment`);
      void scrapeAndEnrichFn(instituteId, instituteName, website);
    }

    const contextSection = instituteData
      ? `INSTITUTE INFORMATION about ${instituteName}:\n\n${instituteData}`
      : `You represent ${instituteName}. Detailed info is still loading. Ask what the student wants to know.`;

    const bookingAction = website
      ? `Direct them: "Please visit ${website} to book your free demo, or share your phone number and our team will call you back."`
      : `Direct them: "Please share your phone number and our team will call you back to schedule your demo."`;

    // Training data: personality profile + relevant past examples
    const [personality, relevantExamples] = await Promise.all([
      getPersonalityProfile(instituteId),
      getRelevantExamples(instituteId, studentMessage, 4),
    ]);

    let personalitySection = '';
    if (personality) {
      const langNote =
        personality.languageStyle === 'hinglish'
          ? '\nLANGUAGE: This counselor writes in Hinglish (Hindi + English mix). Match this naturally.'
          : personality.languageStyle === 'hindi'
          ? '\nLANGUAGE: This counselor writes in Hindi. Reply in Hindi.'
          : '';
      personalitySection =
        `\n\n---\n\nCOUNSELOR STYLE (learned from real conversations — follow this):\n\n` +
        `${personality.profile}${langNote}`;
      console.log(`[WA] Personality injected (${personality.languageStyle})`);
    }

    let examplesSection = '';
    if (relevantExamples.length > 0) {
      const examplesText = relevantExamples
        .map((ex, i) =>
          `[Example ${i + 1}]\nStudent: ${ex.studentMessage}\nCounselor: ${ex.ownerReply}`,
        ).join('\n\n');
      examplesSection =
        `\n\n---\n\nREAL PAST CONVERSATIONS (match this style):\n\n${examplesText}`;
      console.log(`[WA] ${relevantExamples.length} RAG examples injected`);
    }

    const recentTranscript = recentHistory.slice(-6)
      .map(m => `${m.role === 'user' ? 'Student' : 'AI'}: ${m.content.slice(0, 200)}`)
      .join('\n');

    // Check if student's phone number already appears in history
    const phoneAlreadyShared = recentHistory.some(m =>
      m.role === 'user' && /\b[6-9]\d{9}\b/.test(m.content),
    );

    return (
      `You are an AI admission assistant for ${instituteName}, responding on WhatsApp.\n\n` +

      `STEP 1 — READ THE CONVERSATION STATE\n` +
      `Analyse the conversation below and identify the current state:\n\n` +
      `GREETING   — first contact, student just said hi or introduced themselves\n` +
      `EXPLORING  — asking about courses, fees, duration, eligibility, placement, trainers\n` +
      `BOOKING    — explicitly wants to book a demo, visit, or speak with a counselor\n` +
      `CLOSING    — saying thanks, ok, bye, nice talking, done, goodbye — ending the conversation\n` +
      `LOOP       — AI already answered this same question earlier in this conversation\n` +
      `OBJECTION  — concern about price, budget, timing, not sure, needs to think\n\n` +

      `Recent conversation:\n${recentTranscript || '(new conversation)'}\n\n` +

      `STEP 2 — REPLY BASED ON STATE\n\n` +

      `GREETING → Welcome briefly. Ask ONE open question about what they are looking for. Do NOT list all courses.\n\n` +

      `EXPLORING → Answer their specific question using the institute info below. ` +
      `Maximum 3-4 sentences. End with ONE relevant follow-up. Do not repeat what was said earlier.\n\n` +

      `BOOKING → ${bookingAction} Stop here. No more questions.\n\n` +

      `CLOSING → 1-2 warm sentences ONLY. Example: "You're welcome! Feel free to reach out anytime. 😊" ` +
      `Do NOT ask a question. Do NOT recommend courses. Do NOT say "What brings you here". Just say goodbye.\n\n` +

      `LOOP → Do NOT repeat the information. Give ONE clear next step (booking or callback) and stop.\n\n` +

      `OBJECTION → Acknowledge the concern warmly in one sentence. Then address it. ` +
      `If budget is low, suggest a cheaper course or EMI. If they need time, offer to follow up later.\n\n` +

      `---\n\n` +
      `${contextSection}` +
      personalitySection +
      examplesSection +
      `\n\n---\n\n` +

      `LANGUAGE RULE:\n` +
      `If the student writes in Hindi or Hinglish, reply in Hinglish naturally. ` +
      `If they write in English, reply in English. Match their style.\n\n` +

      (phoneAlreadyShared ? `IMPORTANT: The student already shared their phone number in this conversation. Do NOT ask for it again.\n\n` : '') +

      `OUTPUT FORMAT (follow exactly):\n` +
      `STATE: <one word>\n` +
      `<your reply>\n\n` +

      `RULES:\n` +
      `- Plain text only. No asterisks, no bullet points, no markdown.\n` +
      `- Maximum 4 sentences. This is WhatsApp on a phone.\n` +
      `- One question per message maximum.\n` +
      `- Never repeat information already in this conversation.\n` +
      `- Never invent fees, dates, or details not in the institute info above.`
    );
  } catch (err) {
    console.error(`[WA] buildSystemPrompt failed:`, err);
    return (
      `You are a helpful AI admission assistant. Reply warmly in plain text.\n` +
      `First line must be: STATE: EXPLORING\n` +
      `Then write your reply.`
    );
  }
}

// ── Generate AI reply ─────────────────────────────────────────────────────────

export async function getAIReply(
  instituteId: number,
  studentPhone: string,
  messageText: string,
): Promise<string | null> {
  console.log(`[WA] getAIReply START — institute ${instituteId}`);
  try {
    const sessionId = `wa-${instituteId}-${studentPhone}`;

    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
      [sessionId],
    );
    const history = historyResult.rows as MessageRow[];
    console.log(`[WA] History: ${history.length} messages`);

    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', messageText.trim()],
    );

    const systemPrompt = await buildSystemPrompt(instituteId, messageText, history);

    console.log(`[WA] Calling GPT-4o-mini...`);
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: messageText.trim() },
      ],
      temperature: 0.7,
      max_tokens: 350,
    });

    const rawOutput = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!rawOutput) return null;

    // Parse STATE from first line, reply from the rest
    const lines = rawOutput.split('\n').filter(l => l.trim() !== '');
    const firstLine = lines[0]?.trim() ?? '';
    let detectedState = 'EXPLORING';
    let reply = rawOutput;

    if (firstLine.toUpperCase().startsWith('STATE:')) {
      detectedState = firstLine.replace(/^STATE:\s*/i, '').trim().toUpperCase();
      reply = lines.slice(1).join('\n').trim();
      if (!reply) reply = rawOutput; // fallback if model put everything on one line
    }

    console.log(`[WA] State: ${detectedState} | Reply (${reply.length} chars): ${reply.slice(0, 100)}`);

    // Hard character limits per state to prevent walls of text
    const charLimits: Record<string, number> = {
      CLOSING: 180,
      LOOP: 250,
      BOOKING: 280,
    };
    const limit = charLimits[detectedState];
    const finalReply = limit && reply.length > limit
      ? reply.slice(0, reply.lastIndexOf(' ', limit)) + '.'
      : reply;

    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'assistant', finalReply],
    );

    return finalReply;
  } catch (err) {
    console.error(`[WA] getAIReply FAILED:`, err);
    return null;
  }
}

// ── Puppeteer client factory ─────────────────────────────────────────────────

function makeClient(instituteId: string): Client {
  return new Client({
    authStrategy: new LocalAuth({ clientId: `institute-${instituteId}` }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
    },
  });
}

// ── Init session ─────────────────────────────────────────────────────────────

export async function initSession(instituteId: string): Promise<void> {
  if (initLocks.has(instituteId)) {
    console.log(`[WA] initSession skipped — already initializing ${instituteId}`);
    return;
  }

  const existing = sessions.get(instituteId);
  if (existing?.status === 'connected') return;
  if (existing?.status === 'initializing' || existing?.status === 'qr') return;

  initLocks.add(instituteId);

  console.log(`[WA] Initializing session for institute ${instituteId}`);
  const client = makeClient(instituteId);
  const state: SessionState = { client, qr: null, status: 'initializing' };
  sessions.set(instituteId, state);

  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  client.on('qr', (qr) => {
    state.qr = qr;
    state.status = 'qr';
    console.log(`[WA] QR received for institute ${instituteId}`);
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`[WA] Loading institute ${instituteId}: ${percent}% — ${message}`);
  });

  client.on('authenticated', () => {
    if (watchdogTimer !== null) return; // guard — fires once per linked device
    console.log(`[WA] ✅ Authenticated for institute ${instituteId} — waiting for ready...`);

    void (client as unknown as { pupPage?: { on?: (e: string, cb: (err: Error) => void) => void } })
      .pupPage?.on?.('pageerror', (err: Error) => {
        console.error(`[WA] Page error for institute ${instituteId}:`, err.message?.slice(0, 200));
      });

    watchdogTimer = setTimeout(() => {
      console.error(`[WA] ⚠️ Watchdog: ready never fired for institute ${instituteId} after 90s.`);
      void state.client.destroy().catch(() => { /* ignore */ });
      sessions.delete(instituteId);
      initLocks.delete(instituteId);
      void pool.query(`UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`, [Number(instituteId)]);
    }, 90_000);
  });

  client.on('ready', async () => {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    state.qr = null;
    state.status = 'connected';
    initLocks.delete(instituteId);
    console.log(`[WA] ✅ Client READY for institute ${instituteId}`);
    await pool.query(`UPDATE institutes SET whatsapp_connected = TRUE WHERE id = $1`, [Number(instituteId)]);
  });

  client.on('disconnected', async (reason) => {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    state.status = 'disconnected';
    initLocks.delete(instituteId);
    console.log(`[WA] Disconnected institute ${instituteId}: ${reason}`);
    await pool.query(`UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`, [Number(instituteId)]);
  });

  client.on('auth_failure', (msg) => {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    state.status = 'disconnected';
    initLocks.delete(instituteId);
    console.error(`[WA] Auth failure for institute ${instituteId}:`, msg);
  });

  client.on('message', async (msg: Message) => {
    if (msg.fromMe) return;
    if (msg.from.endsWith('@g.us')) return;
    if (msg.from.endsWith('@newsletter')) return;
    if (msg.from.endsWith('@lid')) return;
    if (msg.from === 'status@broadcast') return;
    if (!msg.body || msg.body.trim() === '') return;

    const phoneClean = msg.from.replace('@c.us', '').replace(/[\s\-\+]/g, '');
    if (await isNumberBlocked(Number(instituteId), phoneClean)) {
      console.log(`[WA] Blocked: ${phoneClean}`); return;
    }

    const studentPhone = msg.from.replace('@c.us', '');
    const messageText = msg.body;

    console.log(`[WA] ===== INCOMING =====`);
    console.log(`[WA] Institute: ${instituteId} | From: ${studentPhone} | Text: ${messageText}`);

    // Reply FIRST, saveLead AFTER — avoids concurrent API calls
    try {
      const reply = await getAIReply(Number(instituteId), studentPhone, messageText);
      if (reply) {
        await client.sendMessage(msg.from, reply);
        console.log(`[WA] ===== REPLY SENT =====`);
      } else {
        // GPT returned null — log only, no fallback
        // The previous fallback "Thank you for contacting..." was sending on every
        // rate-limited message, causing the repeated identical message bug.
        // Silent failure is better than spamming the student.
        console.error(`[WA] GPT returned null — no reply sent. Check OPENAI_API_KEY and quota.`);
      }
    } catch (err) {
      console.error(`[WA] Failed to send reply:`, err);
    }

    void saveLead(Number(instituteId), studentPhone, messageText);
  });

  await client.initialize();
}

// ── Exports ──────────────────────────────────────────────────────────────────

export function getSessionState(instituteId: string): { status: WAStatus; qr: string | null } {
  const s = sessions.get(instituteId);
  return s ? { status: s.status, qr: s.qr } : { status: 'disconnected', qr: null };
}

export async function disconnectSession(instituteId: string): Promise<void> {
  const s = sessions.get(instituteId);
  if (!s) return;
  try { await s.client.destroy(); } catch { /* ignore */ }
  sessions.delete(instituteId);
  initLocks.delete(instituteId);
  await pool.query(`UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`, [Number(instituteId)]);
}

export async function sendMessageToStudent(
  instituteId: string,
  toNumber: string,
  message: string,
): Promise<boolean> {
  const s = sessions.get(instituteId);
  if (!s || s.status !== 'connected') return false;
  try {
    await s.client.sendMessage(toNumber, message);
    return true;
  } catch (err) {
    console.error(`[WA] sendMessageToStudent failed:`, err);
    return false;
  }
}

export async function restoreAllSessions(): Promise<void> {
  try {
    const result = await pool.query(`SELECT id FROM institutes WHERE whatsapp_connected = TRUE`);
    const ids: number[] = result.rows.map((r: { id: number }) => r.id);
    console.log(`[WA] Restoring ${ids.length} session(s)...`);
    for (const id of ids) void initSession(String(id));
  } catch (err) {
    console.error('[WA] restoreAllSessions failed:', err);
  }
}