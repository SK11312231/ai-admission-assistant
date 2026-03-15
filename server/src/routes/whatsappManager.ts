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

type ConversationState =
  | 'GREETING'
  | 'EXPLORING'
  | 'BOOKING'
  | 'CLOSING'
  | 'LOOP'
  | 'OBJECTION';

// ── In-memory session store ──────────────────────────────────────────────────

const sessions = new Map<string, SessionState>();

// Initialization lock — prevents multiple concurrent initSession calls for the
// same institute from all racing past the guard and creating 3 client instances.
// This was causing "authenticated 3x" in logs.
const initLocks = new Set<string>();

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

// ── Stage 1: Classify conversation state ─────────────────────────────────────

async function classifyConversationState(
  history: MessageRow[],
  currentMessage: string,
): Promise<ConversationState> {
  try {
    const recent = history.slice(-6);
    const transcript = recent
      .map(m => `${m.role === 'user' ? 'Student' : 'AI'}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const client = getOpenAI();
    const result = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content:
          `Classify the state of this WhatsApp admission enquiry.\n\n` +
          `Recent conversation:\n${transcript || '(no history)'}\n\n` +
          `Latest message: "${currentMessage}"\n\n` +
          `Reply ONE word only:\n` +
          `GREETING   — first contact\n` +
          `EXPLORING  — asking about courses, fees, eligibility, batches\n` +
          `BOOKING    — wants to book demo, visit, or speak with someone\n` +
          `CLOSING    — thanks, bye, ok, got it, noted — wrapping up\n` +
          `LOOP       — AI already answered this before\n` +
          `OBJECTION  — too expensive, needs time, not sure\n\nState:`,
      }],
      temperature: 0,
      max_tokens: 5,
    });

    const raw = result.choices[0]?.message?.content?.trim().toUpperCase() ?? '';
    const valid: ConversationState[] = ['GREETING', 'EXPLORING', 'BOOKING', 'CLOSING', 'LOOP', 'OBJECTION'];
    const state = valid.find(s => raw.startsWith(s)) ?? 'EXPLORING';
    console.log(`[WA] State: ${state}`);
    return state;
  } catch (err) {
    console.error('[WA] classifyState failed:', err);
    return 'EXPLORING';
  }
}

// ── Stage 2: Build system prompt (state + knowledge + personality + RAG) ─────
//
// This is the core of the personalisation feature.
// Every reply now has four layers of context:
//
//   1. STATE INSTRUCTION  — what kind of reply to produce right now
//   2. INSTITUTE DATA     — courses, fees, enriched profile from website
//   3. PERSONALITY PROFILE — how this specific counselor communicates
//                            (learned from uploaded real WhatsApp chats)
//   4. RELEVANT EXAMPLES   — 3-4 real past conversations most similar to
//                            the current student message (RAG retrieval)
//
// If an institute hasn't uploaded training data yet, layers 3 & 4 are skipped
// and the AI falls back to the generic few-shot examples.

async function buildSystemPrompt(
  instituteId: number,
  state: ConversationState,
  studentMessage: string,
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
      ? `You have the following detailed information about ${instituteName}:\n\n${instituteData}`
      : `You are representing ${instituteName}. Detailed profile is still being generated. ` +
        `Ask the student what they want to know (courses, fees, eligibility) so you can help.`;

    const bookingAction = website
      ? `Tell them: "Please visit ${website} to book your free demo, or share your phone number and our team will call you back."`
      : `Tell them: "Please share your phone number and our team will call you back to schedule your demo."`;

    // ── State-specific directive ──────────────────────────────────────────────
    const stateInstructions: Record<ConversationState, string> = {
      GREETING:
        `STATE: GREETING — Welcome the student briefly. Ask ONE open question to understand ` +
        `what they are looking for. Do not list all courses yet.`,
      EXPLORING:
        `STATE: EXPLORING — Answer their question using the institute info below. ` +
        `Then ask ONE follow-up question to move toward a demo booking. ` +
        `Do not repeat anything already said in this conversation.`,
      BOOKING:
        `STATE: BOOKING — ${bookingAction} Do NOT ask more questions. Just give the next step and stop.`,
      CLOSING:
        `STATE: CLOSING — Student is ending the conversation. ` +
        `Reply with 1-2 warm closing sentences ONLY. No new questions. No more pitching. Stop.`,
      LOOP:
        `STATE: LOOP — You have already given this information. Do NOT repeat it. ` +
        `Give ONE concrete next step (booking or callback) and stop.`,
      OBJECTION:
        `STATE: OBJECTION — Acknowledge their concern warmly in one sentence, then address it. ` +
        `If they need time, offer a follow-up and ask for their number.`,
    };

    // ── Layer 3 & 4: Fetch training data in parallel ──────────────────────────
    // Both are DB reads — run together to save time
    const [personality, relevantExamples] = await Promise.all([
      getPersonalityProfile(instituteId),
      getRelevantExamples(instituteId, studentMessage, 4),
    ]);

    // ── Build personality section ─────────────────────────────────────────────
    let personalitySection = '';
    if (personality) {
      const langNote =
        personality.languageStyle === 'hinglish'
          ? '\nLANGUAGE: This counselor writes in Hinglish (Hindi + English mix). Match this naturally.'
          : personality.languageStyle === 'hindi'
          ? '\nLANGUAGE: This counselor writes primarily in Hindi. Match this.'
          : '';

      personalitySection =
        `\n\n---\n\nCOUNSELOR COMMUNICATION PROFILE\n` +
        `(Learned from this institute's real WhatsApp conversations — follow this style closely)\n\n` +
        `${personality.profile}${langNote}`;

      console.log(`[WA] Personality profile injected (${personality.languageStyle})`);
    }

    // ── Build RAG examples section ────────────────────────────────────────────
    let examplesSection = '';
    if (relevantExamples.length > 0) {
      const examplesText = relevantExamples
        .map((ex, i) =>
          `[Real Example ${i + 1} — ${ex.category}]\n` +
          `Student: ${ex.studentMessage}\n` +
          `Counselor: ${ex.ownerReply}`,
        )
        .join('\n\n');

      examplesSection =
        `\n\n---\n\nREAL PAST CONVERSATIONS from this institute\n` +
        `(These are how the actual counselor responded to similar questions — use their style)\n\n` +
        `${examplesText}\n\n` +
        `Adapt the style and approach from these examples. Do not copy word-for-word.`;

      console.log(`[WA] ${relevantExamples.length} relevant examples injected`);
    }

    // ── Generic fallback examples (only when no training data at all) ─────────
    const fallbackExamples =
      !personality && relevantExamples.length === 0
        ? `\n\n---\n\nCONVERSATION STYLE EXAMPLES:\n\n` +
          `[Closing] Student: ok thanks → Reply: You're welcome! Feel free to reach out anytime. 😊\n\n` +
          `[Booking] Student: I want to book a demo → Reply: ${
            website
              ? `Great! Please visit ${website} to book your free demo, or share your number and we'll call you.`
              : `Great! Share your number and our team will call you back to schedule it.`
          }\n\n` +
          `[Loop] Student: Yes → Reply: ${
            website
              ? `The easiest next step is to visit ${website} and book a free demo. Our team will walk you through everything.`
              : `Please share your number and our team will call you to set everything up.`
          }`
        : '';

    return (
      `You are an AI admission assistant for ${instituteName}.\n\n` +
      `CURRENT INSTRUCTION: ${stateInstructions[state]}\n\n` +
      `---\n\nINSTITUTE INFORMATION:\n${contextSection}` +
      personalitySection +
      examplesSection +
      fallbackExamples +
      `\n\n---\n\nHARD RULES (always apply):\n` +
      `- Plain text only — no markdown, no asterisks, no bullet dashes.\n` +
      `- Maximum 3 short paragraphs. WhatsApp must be readable on a phone screen.\n` +
      `- Never repeat information already given in this conversation.\n` +
      `- Never ask more than one question per message.\n` +
      `- Never invent fees, dates, or details not in the institute information above.`
    );
  } catch (err) {
    console.error(`[WA] buildSystemPrompt failed:`, err);
    return `You are a helpful AI admission assistant. Reply warmly and concisely in plain text.`;
  }
}

// ── Generate AI reply ─────────────────────────────────────────────────────────

async function getAIReply(
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

    const state = await classifyConversationState(history, messageText);

    // Pass studentMessage to buildSystemPrompt for RAG retrieval
    const systemPrompt = await buildSystemPrompt(instituteId, state, messageText);
    console.log(`[WA] Calling Groq (state: ${state})...`);

    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: messageText.trim() },
      ],
      temperature: state === 'CLOSING' || state === 'BOOKING' ? 0.3 : 0.7,
      max_tokens: state === 'CLOSING' ? 80 : state === 'BOOKING' ? 120 : 400,
    });

    const reply = completion.choices[0]?.message?.content?.trim()
      || 'Sorry, I could not generate a response.';
    console.log(`[WA] Groq reply (${reply.length} chars): ${reply.slice(0, 80)}`);

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

// ── Puppeteer client factory ─────────────────────────────────────────────────
//
// Chrome flag notes for Railway:
// - --no-sandbox + --disable-setuid-sandbox: required in containers
// - --disable-dev-shm-usage: prevents /dev/shm OOM crashes
// - --no-zygote: REMOVED — without --single-process, this breaks renderer spawning
// - --single-process: REMOVED — causes silent crash after QR auth
// - --disable-gpu: safe, no GPU in container
// The minimal safe set below is proven to work in Railway/Docker environments.

function makeClient(instituteId: string): Client {
  return new Client({
    authStrategy: new LocalAuth({ clientId: `institute-${instituteId}` }),
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-translate',
        '--safebrowsing-disable-auto-update',
        '--metrics-recording-only',
        '--mute-audio',
        '--window-size=1280,720',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-client-side-phishing-detection',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--force-color-profile=srgb',
        '--disable-blink-features=AutomationControlled',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: 'new' as unknown as boolean, // 'new' headless mode — more stable than true on Railway
    },
  });
}

// ── Init session ─────────────────────────────────────────────────────────────

export async function initSession(instituteId: string): Promise<void> {
  // Lock guard — if another call is already initializing this institute, skip.
  // Without this, concurrent calls (restoreAllSessions + user click) all race
  // past the status check before status is set, creating 3 client instances.
  if (initLocks.has(instituteId)) {
    console.log(`[WA] initSession skipped — already initializing institute ${instituteId}`);
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

  // Watchdog: if 'ready' doesn't fire within 90s after 'authenticated',
  // destroy the session so the institute can try again rather than hanging forever.
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
    // whatsapp-web.js fires 'authenticated' once per linked device on the phone.
    // Guard the watchdog so it only starts ONCE no matter how many times this fires.
    if (watchdogTimer !== null) return;
    console.log(`[WA] ✅ Authenticated for institute ${instituteId} — waiting for ready...`);
    watchdogTimer = setTimeout(() => {
      console.error(`[WA] ⚠️ Watchdog: ready never fired for institute ${instituteId} after 90s. Destroying session.`);
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

    // Reply FIRST — saveLead AFTER (prevents concurrent Groq calls)
    try {
      const reply = await getAIReply(Number(instituteId), studentPhone, messageText);
      if (reply) {
        await client.sendMessage(msg.from, reply);
        console.log(`[WA] ===== REPLY SENT =====`);
      } else {
        const r = await pool.query('SELECT name FROM institutes WHERE id = $1', [Number(instituteId)]);
        const fallback = `Thank you for contacting ${r.rows[0]?.name ?? 'us'}! We received your message and will get back to you shortly.`;
        await client.sendMessage(msg.from, fallback);
        console.log(`[WA] ===== FALLBACK SENT =====`);
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
  instituteId: string, toNumber: string, message: string,
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