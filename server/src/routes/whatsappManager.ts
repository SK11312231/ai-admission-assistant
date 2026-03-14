import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import OpenAI from 'openai';
import pool from '../db';
import { isNumberBlocked } from './blocklist';
import { getInstituteDetails, scrapeAndEnrich as scrapeAndEnrichFn } from './instituteEnrichment';
import { sendNewLeadEmail } from './emailService';

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

// Conversation states detected by the classifier
type ConversationState =
  | 'GREETING'    // First message or re-introduction
  | 'EXPLORING'   // Asking about courses, fees, eligibility
  | 'BOOKING'     // Wants to book a demo or speak with someone
  | 'CLOSING'     // Saying thanks, bye, ok, got it — wrapping up
  | 'LOOP'        // Conversation going in circles, same info repeated
  | 'OBJECTION';  // Has a concern — too expensive, not sure, needs time

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

// ── Save lead (self-contained) ───────────────────────────────────────────────

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
  const urlOnly = /^https?:\/\/\S+$/.test(message.trim());
  if (urlOnly) return true;
  return false;
}

async function saveLead(
  instituteId: number,
  studentPhone: string,
  message: string,
): Promise<void> {
  try {
    if (isSpam(studentPhone, message)) {
      console.log(`[WA] Spam detected, skipping lead save: ${studentPhone}`);
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
      return; // existing lead — no Groq call needed
    }

    // New lead — extract name via Groq
    // Runs AFTER getAIReply completes to avoid concurrent Groq calls hitting rate limits
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

    // Send new lead email notification (fire-and-forget)
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
        console.error('[WA] New lead email failed (non-fatal):', err);
      }
    })();
  } catch (err) {
    console.error(`[WA] saveLead failed (non-fatal):`, err);
  }
}

// ── Stage 1: Classify conversation state ─────────────────────────────────────
//
// Runs a fast, cheap Groq call (max_tokens: 5) BEFORE generating the main reply.
// Returns one of 6 states that tells the AI exactly what kind of response is needed.
// This removes the guesswork — the AI no longer has to infer conversation stage
// from rules; it's told directly via the CURRENT INSTRUCTION line in the prompt.

async function classifyConversationState(
  history: MessageRow[],
  currentMessage: string,
): Promise<ConversationState> {
  try {
    // Last 6 messages is enough context to determine state — saves tokens
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
          `You are classifying the state of a WhatsApp admission enquiry conversation.\n\n` +
          `Recent conversation:\n${transcript || '(no history yet)'}\n\n` +
          `Latest student message: "${currentMessage}"\n\n` +
          `Reply with ONLY one word:\n` +
          `GREETING   — first contact, no prior context\n` +
          `EXPLORING  — asking about courses, fees, eligibility, duration, batches\n` +
          `BOOKING    — explicitly wants to book a demo, visit, or speak with someone\n` +
          `CLOSING    — saying thanks, bye, ok, got it, noted, sure — wrapping up\n` +
          `LOOP       — AI has already answered this exact question or given this info before\n` +
          `OBJECTION  — has a concern: too expensive, needs time, not sure, will think about it\n\n` +
          `State:`,
      }],
      temperature: 0,
      max_tokens: 5,
    });

    const raw = result.choices[0]?.message?.content?.trim().toUpperCase() ?? '';
    const valid: ConversationState[] = ['GREETING', 'EXPLORING', 'BOOKING', 'CLOSING', 'LOOP', 'OBJECTION'];
    const state = valid.find(s => raw.startsWith(s)) ?? 'EXPLORING';
    console.log(`[WA] Conversation state classified: ${state}`);
    return state;
  } catch (err) {
    console.error('[WA] classifyConversationState failed (defaulting to EXPLORING):', err);
    return 'EXPLORING'; // safe fallback
  }
}

// ── Stage 2: Build system prompt with state + few-shot examples ───────────────
//
// The prompt has three layers:
//   1. CURRENT INSTRUCTION  — state-specific directive injected at the very top
//   2. Institute context    — courses, fees, eligibility from the enriched profile
//   3. Few-shot examples    — real conversation patterns teach behaviour better than rules

async function buildSystemPrompt(
  instituteId: number,
  state: ConversationState,
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
      console.log(`[WA] No institute details found for ${instituteId} — triggering enrichment`);
      void scrapeAndEnrichFn(instituteId, instituteName, website);
    }

    const contextSection = instituteData
      ? `You have the following detailed information about ${instituteName}:\n\n${instituteData}`
      : `You are representing ${instituteName}. Detailed profile data is still being gathered. ` +
        `Be honest about this and ask the student what they want to know (courses, fees, eligibility).`;

    // Concrete booking action — uses website URL if available, falls back to callback
    const bookingAction = website
      ? `Tell them: "Please visit ${website} to book your free demo session, or share your phone number and our team will call you back to confirm."`
      : `Tell them: "Please share your phone number and our team will call you back shortly to schedule your free demo session."`;

    // ── State-specific instructions ───────────────────────────────────────────
    // Each state gets a precise directive. This is injected as the FIRST thing
    // the AI reads — it overrides any ambiguity about how to respond.
    const stateInstructions: Record<ConversationState, string> = {
      GREETING:
        `STATE: GREETING — New conversation starting. Give a warm, brief welcome message. ` +
        `Ask exactly ONE open question to understand what the student is looking for. ` +
        `Do NOT list courses yet. Do NOT ask multiple questions.`,

      EXPLORING:
        `STATE: EXPLORING — Student is looking for information. Answer their specific question ` +
        `concisely using only the institute information below. Then ask ONE focused follow-up ` +
        `question that moves toward a concrete outcome (demo booking or counselor call). ` +
        `Do NOT repeat anything already said in this conversation.`,

      BOOKING:
        `STATE: BOOKING — Student wants to book a demo or speak with someone. ` +
        `${bookingAction} ` +
        `Do NOT ask any more questions. Do NOT describe courses again. ` +
        `Just give them the single next action and stop.`,

      CLOSING:
        `STATE: CLOSING — The student is ending this conversation. ` +
        `Write 1-2 warm closing sentences ONLY. ` +
        `Do NOT ask another question. Do NOT pitch more courses. Do NOT say "What brings you here". ` +
        `Do NOT restart the conversation. Just say goodbye warmly and stop.`,

      LOOP:
        `STATE: LOOP — This conversation is repeating itself. You have already given this information. ` +
        `Do NOT repeat it again under any circumstances. ` +
        `Give ONE concrete next step only: a booking link, a callback request, or a closure. ` +
        `Then stop. Break the loop now.`,

      OBJECTION:
        `STATE: OBJECTION — Student has a concern or hesitation. ` +
        `First acknowledge their concern warmly in one sentence. ` +
        `Then address it directly and briefly. ` +
        `If they need time, offer to follow up later and ask for their preferred contact number.`,
    };

    // ── Few-shot examples ─────────────────────────────────────────────────────
    // These teach the AI the exact response pattern for each state.
    // Examples are far more reliable than rules for LLM instruction-following.
    const fewShotExamples = `
CONVERSATION EXAMPLES — match this response style exactly:

[CLOSING — student says thanks or wraps up]
Student: ok thanks
AI: You're welcome! Feel free to reach out anytime if you have more questions. We look forward to hearing from you. 😊

Student: thanks, will check
AI: Of course! Take your time. We're here whenever you're ready. Have a great day! 😊

[BOOKING — student explicitly asks to book]
Student: Yes I would like to book a free demo
AI: ${website
      ? `Great! Please visit ${website} to book your free demo session. You can also share your phone number here and our team will call you back to confirm the timing.`
      : `Great! Please share your phone number and our team will call you back shortly to schedule your free demo session.`}

Student: please book a free demo for data science
AI: ${website
      ? `Happy to help! Please visit ${website} to book your Data Science demo session. Alternatively, share your phone number and our counselor will call you back to set it up.`
      : `Happy to help! Please share your phone number and our counselor will call you back to schedule your Data Science demo session.`}

[LOOP — student keeps saying Yes but nothing new is being asked]
Student: Yes
AI: ${website
      ? `Got it! The easiest next step is to visit ${website} and book a free demo session. Our counselor will walk you through everything. Alternatively, share your number and we'll call you.`
      : `Got it! The easiest next step is to share your phone number so our counselor can call you and walk you through everything.`}

[GREETING — first message]
Student: Hi
AI: Hi! Welcome to ${instituteName}. Are you looking to learn a new skill or upskill in a specific area?

Student: Hello
AI: Hello! Thanks for reaching out to ${instituteName}. What course or subject are you interested in?

[EXPLORING — answer and move forward]
Student: What is the fee for data science?
AI: Our Data Science course fee is [fee from institute data]. The course duration is [duration]. Would you like to book a free demo session to speak with a counselor directly?

[OBJECTION — student is hesitant]
Student: I need some time to think
AI: Of course, take all the time you need! If it helps, you can attend a free demo session first with no commitment. Would you like me to arrange one whenever you're ready?

Student: it seems expensive
AI: That's completely understandable. We do offer flexible payment options and scholarship opportunities. Would you like to speak with a counselor who can walk you through the options in detail?
`;

    return (
      `You are an AI admission assistant for ${instituteName}.\n\n` +
      `CURRENT INSTRUCTION: ${stateInstructions[state]}\n\n` +
      `---\n\n` +
      `${contextSection}\n\n` +
      `---\n\n` +
      `${fewShotExamples}\n` +
      `---\n\n` +
      `HARD RULES (always apply regardless of state):\n` +
      `- Plain text only. No markdown, no asterisks, no dashes, no bold.\n` +
      `- Maximum 3 short paragraphs. WhatsApp must be readable on a phone screen.\n` +
      `- Never repeat information already given in this conversation.\n` +
      `- Never ask more than one question per message.\n` +
      `- Never invent fees, dates, or course details not present in the institute data above.`
    );
  } catch (err) {
    console.error(`[WA] buildSystemPrompt failed:`, err);
    return `You are a helpful AI admission assistant for an educational institute. Reply warmly and concisely in plain text. Never repeat yourself.`;
  }
}

// ── Generate AI reply (two-stage pipeline) ───────────────────────────────────
//
// STAGE 1 — classifyConversationState()
//   Fast Groq call, ~5 tokens output, returns one of 6 state labels.
//
// STAGE 2 — buildSystemPrompt() + main Groq call
//   System prompt has state-specific instruction at the top + few-shot examples.
//   max_tokens and temperature are tuned per state for tighter responses.

async function getAIReply(
  instituteId: number,
  studentPhone: string,
  messageText: string,
): Promise<string | null> {
  console.log(`[WA] getAIReply START — institute ${instituteId}`);
  try {
    const sessionId = `wa-${instituteId}-${studentPhone}`;

    // Fetch last 20 messages BEFORE inserting current message (avoids duplication in context)
    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
      [sessionId],
    );
    const history = historyResult.rows as MessageRow[];
    console.log(`[WA] History: ${history.length} messages`);

    // Save current user message to DB
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', messageText.trim()],
    );

    // ── Stage 1: Classify ────────────────────────────────────────────────────
    const state = await classifyConversationState(history, messageText);

    // ── Stage 2: Build prompt and generate reply ─────────────────────────────
    const systemPrompt = await buildSystemPrompt(instituteId, state);
    console.log(`[WA] Calling Groq (state: ${state})...`);

    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: messageText.trim() },
      ],
      // Tighter settings for states that need short, precise replies
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

function makeClient(instituteId: string): Client {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: `institute-${instituteId}`,
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
    console.log(`[WA] ✅ Client READY for institute ${instituteId}`);
    state.qr = null;
    state.status = 'connected';
    await pool.query(`UPDATE institutes SET whatsapp_connected = TRUE WHERE id = $1`, [Number(instituteId)]);
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
    if (msg.fromMe) return;
    if (msg.from.endsWith('@g.us')) return;
    if (msg.from.endsWith('@newsletter')) return;
    if (msg.from.endsWith('@lid')) return;
    if (msg.from === 'status@broadcast') return;
    if (!msg.body || msg.body.trim() === '') return;

    const phoneClean = msg.from.replace('@c.us', '').replace(/[\s\-\+]/g, '');
    const blocked = await isNumberBlocked(Number(instituteId), phoneClean);
    if (blocked) {
      console.log(`[WA] Blocked number ${phoneClean} — ignoring message.`);
      return;
    }

    const studentPhone = msg.from.replace('@c.us', '');
    const messageText = msg.body;

    console.log(`[WA] ===== INCOMING MESSAGE =====`);
    console.log(`[WA] Institute: ${instituteId} | From: ${studentPhone}`);
    console.log(`[WA] Text: ${messageText}`);

    // ── STEP 1: Generate and send AI reply FIRST ─────────────────────────────
    // saveLead (for new leads) calls Groq for name extraction. Running both
    // concurrently would race and hit Groq rate limits, silently killing the reply.
    try {
      const reply = await getAIReply(Number(instituteId), studentPhone, messageText);
      console.log(`[WA] Reply: ${reply ? reply.slice(0, 80) : 'NULL — sending fallback'}`);

      if (reply) {
        await client.sendMessage(msg.from, reply);
        console.log(`[WA] ===== REPLY SENT =====`);
      } else {
        // Groq failed — always send fallback so student isn't left in silence
        const instResult = await pool.query('SELECT name FROM institutes WHERE id = $1', [Number(instituteId)]);
        const instName: string = instResult.rows[0]?.name ?? 'us';
        const fallback = `Thank you for contacting ${instName}! We have received your message and will get back to you shortly.`;
        await client.sendMessage(msg.from, fallback);
        console.log(`[WA] ===== FALLBACK REPLY SENT =====`);
      }
    } catch (err) {
      console.error(`[WA] Failed to send reply:`, err);
    }

    // ── STEP 2: Save/update lead AFTER reply ─────────────────────────────────
    void saveLead(Number(instituteId), studentPhone, messageText);
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

export async function sendMessageToStudent(
  instituteId: string,
  toNumber: string, // format: "919876543210@c.us"
  message: string,
): Promise<boolean> {
  const state = sessions.get(instituteId);
  if (!state || state.status !== 'connected') {
    console.warn(`[WA] sendMessageToStudent: no active session for institute ${instituteId}`);
    return false;
  }
  try {
    await state.client.sendMessage(toNumber, message);
    console.log(`[WA] Follow-up sent to ${toNumber} for institute ${instituteId}`);
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
    console.log(`[WA] Restoring ${ids.length} WhatsApp session(s)...`);
    for (const id of ids) void initSession(String(id));
  } catch (err) {
    console.error('[WA] Failed to restore sessions:', err);
  }
}