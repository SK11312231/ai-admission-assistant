/**
 * whatsappManager.ts — Baileys-based WhatsApp session manager
 *
 * Replaces the previous whatsapp-web.js + Puppeteer implementation.
 * Baileys uses a direct WebSocket connection to WhatsApp — no Chromium needed.
 * This is stable, lightweight, and works perfectly on Railway.
 *
 * Baileys is ESM-only. Since this server compiles to CommonJS, we use a
 * dynamic import() wrapper to load it at runtime — fully supported in Node 20.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaileysModule = typeof import('@whiskeysockets/baileys');

let _baileys: BaileysModule | null = null;
async function getBaileys(): Promise<BaileysModule> {
  if (!_baileys) {
    _baileys = await import('@whiskeysockets/baileys') as BaileysModule;
  }
  return _baileys;
}

let _boom: typeof import('@hapi/boom') | null = null;
async function getBoom(): Promise<typeof import('@hapi/boom')> {
  if (!_boom) {
    _boom = await import('@hapi/boom') as typeof import('@hapi/boom');
  }
  return _boom;
}

import path from 'path';
import OpenAI from 'openai';
import pool from '../db';
import { isNumberBlocked } from './blocklist';
import { getInstituteDetails, scrapeAndEnrich as scrapeAndEnrichFn } from './instituteEnrichment';
import { sendNewLeadEmail } from './emailService';
import { getPersonalityProfile, getRelevantExamples } from './chatTraining';

// ── Types ────────────────────────────────────────────────────────────────────

export type WAStatus = 'initializing' | 'qr' | 'connected' | 'disconnected';

interface SessionState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket: any | null;
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

// Auth files stored in .baileys_auth/<institute-id>/
// These persist across restarts on Railway (not across redeploys).
function authDir(instituteId: string): string {
  return path.join(process.cwd(), '.baileys_auth', `institute-${instituteId}`);
}

// ── OpenAI client ─────────────────────────────────────────────────────────────

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ── Spam filter ───────────────────────────────────────────────────────────────

const SPAM_PATTERNS = [
  /@lid$/, /@newsletter$/, /paymentredirect/i, /policybazaar/i,
  /insuremile/i, /type \*#\*/i, /restart your journey/i,
];

function isSpam(phone: string, message: string): boolean {
  if (SPAM_PATTERNS.some(p => p.test(phone))) return true;
  if (SPAM_PATTERNS.some(p => p.test(message))) return true;
  return /^https?:\/\/\S+$/.test(message.trim());
}

// ── Save lead ─────────────────────────────────────────────────────────────────

async function saveLead(instituteId: number, studentPhone: string, message: string): Promise<void> {
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

    // Extract student name
    let studentName: string | null = null;
    try {
      const client = getOpenAI();
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Extract the student name from the message. Reply ONLY the name, or NULL if not found.' },
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

    // Send notification email
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

// ── Build system prompt ───────────────────────────────────────────────────────

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
    }

    let examplesSection = '';
    if (relevantExamples.length > 0) {
      const examplesText = relevantExamples
        .map((ex, i) => `[Example ${i + 1}]\nStudent: ${ex.studentMessage}\nCounselor: ${ex.ownerReply}`)
        .join('\n\n');
      examplesSection = `\n\n---\n\nREAL PAST CONVERSATIONS (match this style):\n\n${examplesText}`;
    }

    const recentTranscript = recentHistory.slice(-6)
      .map(m => `${m.role === 'user' ? 'Student' : 'AI'}: ${m.content.slice(0, 200)}`)
      .join('\n');

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
      `GREETING → Welcome briefly. Ask ONE open question about what they are looking for.\n\n` +
      `EXPLORING → Answer their specific question using the institute info below. Maximum 3-4 sentences. End with ONE relevant follow-up.\n\n` +
      `BOOKING → ${bookingAction} Stop here. No more questions.\n\n` +
      `CLOSING → 1-2 warm sentences ONLY. Do NOT ask a question. Just say goodbye.\n\n` +
      `LOOP → Do NOT repeat the information. Give ONE clear next step and stop.\n\n` +
      `OBJECTION → Acknowledge the concern warmly. Address it. If budget is low, suggest cheaper option or EMI.\n\n` +
      `---\n\n` +
      `${contextSection}` +
      personalitySection +
      examplesSection +
      `\n\n---\n\n` +
      `LANGUAGE RULE: If student writes in Hindi or Hinglish, reply in Hinglish. If English, reply in English.\n\n` +
      (phoneAlreadyShared ? `IMPORTANT: The student already shared their phone number. Do NOT ask for it again.\n\n` : '') +
      `OUTPUT FORMAT:\nSTATE: <one word>\n<your reply>\n\n` +
      `RULES:\n- Plain text only. No asterisks, no bullet points, no markdown.\n` +
      `- Maximum 4 sentences.\n- One question per message maximum.\n` +
      `- Never repeat information already in this conversation.\n` +
      `- Never invent fees, dates, or details not in the institute info above.`
    );
  } catch (err) {
    console.error(`[WA] buildSystemPrompt failed:`, err);
    return `You are a helpful AI admission assistant. Reply warmly in plain text.\nFirst line must be: STATE: EXPLORING\nThen write your reply.`;
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

    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', messageText.trim()],
    );

    const systemPrompt = await buildSystemPrompt(instituteId, messageText, history);

    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: messageText.trim() },
      ],
      temperature: 0.7,
      max_tokens: 350,
    });

    const rawOutput = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!rawOutput) return null;

    const lines = rawOutput.split('\n').filter(l => l.trim() !== '');
    const firstLine = lines[0]?.trim() ?? '';
    let detectedState = 'EXPLORING';
    let reply = rawOutput;

    if (firstLine.toUpperCase().startsWith('STATE:')) {
      detectedState = firstLine.replace(/^STATE:\s*/i, '').trim().toUpperCase();
      reply = lines.slice(1).join('\n').trim();
      if (!reply) reply = rawOutput;
    }

    console.log(`[WA] State: ${detectedState} | Reply: ${reply.slice(0, 100)}`);

    const charLimits: Record<string, number> = { CLOSING: 180, LOOP: 250, BOOKING: 280 };
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

// ── Send message to student ───────────────────────────────────────────────────

export async function sendMessageToStudent(
  instituteId: string,
  toNumber: string,
  message: string,
): Promise<boolean> {
  const s = sessions.get(instituteId);
  if (!s || s.status !== 'connected' || !s.socket) return false;
  try {
    // Baileys expects JID format: 91XXXXXXXXXX@s.whatsapp.net
    const jid = toNumber.includes('@') ? toNumber : `${toNumber}@s.whatsapp.net`;
    await s.socket.sendMessage(jid, { text: message });
    return true;
  } catch (err) {
    console.error(`[WA] sendMessageToStudent failed:`, err);
    return false;
  }
}

// ── Init session ──────────────────────────────────────────────────────────────

export async function initSession(instituteId: string): Promise<void> {
  if (initLocks.has(instituteId)) return;

  const existing = sessions.get(instituteId);
  if (existing?.status === 'connected') return;
  if (existing?.status === 'initializing' || existing?.status === 'qr') return;

  initLocks.add(instituteId);
  console.log(`[WA] Initializing Baileys session for institute ${instituteId}`);

  const state: SessionState = { socket: null, qr: null, status: 'initializing' };
  sessions.set(instituteId, state);

  try {
    const {
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      makeCacheableSignalKeyStore,
      default: makeWASocket,
      DisconnectReason,
    } = await getBaileys();
    const { Boom } = await getBoom();

    const { state: authState, saveCreds } = await useMultiFileAuthState(authDir(instituteId));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, {
          level: 'silent',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      },
      printQRInTerminal: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: {
        level: 'silent',
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: (msg: unknown) => console.warn('[Baileys]', msg),
        error: (msg: unknown) => console.error('[Baileys]', msg),
        fatal: (msg: unknown) => console.error('[Baileys FATAL]', msg),
        child: () => ({
          level: 'silent',
          trace: () => {}, debug: () => {}, info: () => {},
          warn: () => {}, error: () => {}, fatal: () => {},
          child: () => ({} as any),
        }),
      } as any,
      browser: ['InquiAI', 'Chrome', '120.0'],
      connectTimeoutMs: 60_000,
      retryRequestDelayMs: 500,
      maxMsgRetryCount: 3,
    });

    state.socket = sock;

    // ── Connection updates ──────────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        state.qr = qr;
        state.status = 'qr';
        console.log(`[WA] QR received for institute ${instituteId}`);
      }

      if (connection === 'open') {
        state.qr = null;
        state.status = 'connected';
        initLocks.delete(instituteId);
        console.log(`[WA] ✅ Baileys connected for institute ${instituteId}`);
        await pool.query(
          `UPDATE institutes SET whatsapp_connected = TRUE WHERE id = $1`,
          [Number(instituteId)],
        );
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WA] Connection closed for institute ${instituteId}. Code: ${statusCode}. Reconnect: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          // User logged out — clear auth and mark disconnected
          state.status = 'disconnected';
          state.socket = null;
          initLocks.delete(instituteId);
          sessions.delete(instituteId);
          await pool.query(
            `UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`,
            [Number(instituteId)],
          );
          console.log(`[WA] Institute ${instituteId} logged out — session cleared.`);
        } else if (shouldReconnect) {
          // Network blip — auto-reconnect
          state.status = 'disconnected';
          initLocks.delete(instituteId);
          console.log(`[WA] Auto-reconnecting institute ${instituteId} in 5s...`);
          setTimeout(() => void initSession(instituteId), 5000);
        } else {
          state.status = 'disconnected';
          state.socket = null;
          initLocks.delete(instituteId);
          await pool.query(
            `UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`,
            [Number(instituteId)],
          );
        }
      }
    });

    // ── Save credentials on update ──────────────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Incoming messages ───────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      if (type !== 'notify') return;

      for (const msg of msgs) {
        if (msg.key.fromMe) continue;
        if (!msg.key.remoteJid) continue;

        // Skip group messages
        if (msg.key.remoteJid.endsWith('@g.us')) continue;

        // Extract text
        const messageText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '';

        if (!messageText.trim()) continue;

        // Clean phone number — remove @s.whatsapp.net and country code formatting
        const studentPhone = msg.key.remoteJid.replace('@s.whatsapp.net', '');

        console.log(`[WA] ===== INCOMING =====`);
        console.log(`[WA] Institute: ${instituteId} | From: ${studentPhone} | Text: ${messageText}`);

        // Check blocklist
        const phoneClean = studentPhone.replace(/[\s\-\+]/g, '');
        if (await isNumberBlocked(Number(instituteId), phoneClean)) {
          console.log(`[WA] Blocked: ${phoneClean}`);
          continue;
        }

        // Reply first, save lead after
        try {
          const reply = await getAIReply(Number(instituteId), studentPhone, messageText);
          if (reply && state.socket) {
            await state.socket.sendMessage(msg.key.remoteJid, { text: reply });
            console.log(`[WA] ===== REPLY SENT =====`);
          } else if (!reply) {
            console.error(`[WA] AI returned null — no reply sent.`);
          }
        } catch (err) {
          console.error(`[WA] Failed to send reply:`, err);
        }

        void saveLead(Number(instituteId), studentPhone, messageText);
      }
    });

  } catch (err) {
    console.error(`[WA] initSession failed for institute ${instituteId}:`, err);
    state.status = 'disconnected';
    initLocks.delete(instituteId);
    await pool.query(
      `UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`,
      [Number(instituteId)],
    ).catch(() => {});
  }
}

// ── Get session state (with QR as data URL) ───────────────────────────────────

export function getSessionState(instituteId: string): { status: WAStatus; qr: string | null } {
  const s = sessions.get(instituteId);
  if (!s) return { status: 'disconnected', qr: null };
  return { status: s.status, qr: s.qr };
}

// ── Disconnect session ────────────────────────────────────────────────────────

export async function disconnectSession(instituteId: string): Promise<void> {
  const s = sessions.get(instituteId);
  if (!s) return;
  try {
    if (s.socket) await s.socket.logout();
  } catch { /* ignore */ }
  sessions.delete(instituteId);
  initLocks.delete(instituteId);
  await pool.query(
    `UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`,
    [Number(instituteId)],
  );
}

// ── Restore sessions on startup ───────────────────────────────────────────────

export async function restoreAllSessions(): Promise<void> {
  try {
    const result = await pool.query(`SELECT id FROM institutes WHERE whatsapp_connected = TRUE`);
    const ids: number[] = result.rows.map((r: { id: number }) => r.id);
    console.log(`[WA] Restoring ${ids.length} Baileys session(s)...`);
    for (const id of ids) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      void initSession(String(id)).catch(err => {
        console.error(`[WA] Session restore failed for institute ${id}:`, err);
      });
    }
  } catch (err) {
    console.error('[WA] restoreAllSessions failed:', err);
  }
}