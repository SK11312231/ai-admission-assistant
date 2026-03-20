import { Router, Request, Response } from 'express';
import pool from '../db';
import { getAIReply } from './whatsappManager';
import { isNumberBlocked } from './blocklist';

const router = Router();

/**
 * WhatsApp Cloud API webhook handler.
 *
 * Handles Meta Embedded Signup / Cloud API institutes only.
 * QR-based institutes (whatsapp-web.js) are handled by whatsappManager.ts.
 *
 * Webhook URL to register in Meta App Dashboard:
 *   https://inquiai.in/api/webhook/whatsapp
 *
 * Required env vars:
 *   WHATSAPP_VERIFY_TOKEN  — any secret string you set in Meta dashboard
 *   WHATSAPP_API_TOKEN     — fallback system user token (optional if per-institute token is stored)
 */

// ── Send a WhatsApp message via Cloud API ────────────────────────────────────

async function sendWhatsAppMessage(
  phoneNumberId: string,
  toPhone: string,
  text: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
    throw new Error(`WhatsApp send failed (${res.status}): ${errBody}`);
  }
}

// ── Save / upsert lead ────────────────────────────────────────────────────────

async function upsertLead(
  instituteId: number,
  studentPhone: string,
  message: string,
): Promise<void> {
  try {
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
      await pool.query(
        `INSERT INTO leads (institute_id, student_phone, message, status, last_activity_at)
         VALUES ($1, $2, $3, 'new', NOW())`,
        [instituteId, studentPhone, message],
      );
      console.log(`[Webhook] New lead saved: ${studentPhone} → institute ${instituteId}`);
    }
  } catch (err) {
    console.error('[Webhook] upsertLead failed:', err);
  }
}

// ── GET /api/webhook/whatsapp — Meta verification challenge ─────────────────

router.get('/whatsapp', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode']         as string | undefined;
  const token     = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge']    as string | undefined;

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Webhook] ✅ WhatsApp webhook verified.');
    res.status(200).send(challenge);
    return;
  }

  console.warn(`[Webhook] ❌ Verification failed. Received token: ${token}`);
  res.sendStatus(403);
});

// ── POST /api/webhook/whatsapp — Incoming messages from Meta ────────────────

router.post('/whatsapp', async (req: Request, res: Response) => {
  // Always respond 200 immediately — Meta will retry if we don't
  res.sendStatus(200);

  try {
    const body = req.body as Record<string, unknown>;

    // Parse Meta webhook payload structure
    const entry    = (body.entry    as Array<Record<string, unknown>> | undefined)?.[0];
    const changes  = (entry?.changes as Array<Record<string, unknown>> | undefined)?.[0];
    const value    = changes?.value  as Record<string, unknown> | undefined;
    const messages = value?.messages as Array<Record<string, unknown>> | undefined;
    const metadata = value?.metadata as Record<string, unknown> | undefined;

    // Ignore non-message events (status updates, read receipts etc.)
    if (!messages || messages.length === 0) return;

    const incomingMsg = messages[0];
    const msgType     = incomingMsg.type as string;

    // Only handle text messages
    if (msgType !== 'text') {
      console.log(`[Webhook] Ignored non-text message type: ${msgType}`);
      return;
    }

    const studentPhone    = incomingMsg.from as string;
    const messageBody     = (incomingMsg.text as Record<string, unknown>)?.body as string ?? '';
    const businessPhoneId = metadata?.phone_number_id as string | undefined;

    if (!studentPhone || !messageBody.trim() || !businessPhoneId) {
      console.warn('[Webhook] Missing required fields — skipping.');
      return;
    }

    console.log(`[Webhook] ===== INCOMING =====`);
    console.log(`[Webhook] Phone ID: ${businessPhoneId} | From: ${studentPhone} | Text: ${messageBody}`);

    // ── 1. Find institute by phone_number_id ──────────────────────────────
    // Only match Cloud API institutes (whatsapp_phone_number_id is set)
    const result = await pool.query(
      `SELECT id, name, whatsapp_number, plan, whatsapp_access_token, whatsapp_phone_number_id
       FROM institutes
       WHERE whatsapp_phone_number_id = $1
       LIMIT 1`,
      [businessPhoneId],
    );

    const institute = result.rows[0] as {
      id: number;
      name: string;
      whatsapp_number: string;
      plan: string;
      whatsapp_access_token: string | null;
      whatsapp_phone_number_id: string | null;
    } | undefined;

    if (!institute) {
      console.warn(`[Webhook] No Cloud API institute found for phone_number_id: ${businessPhoneId}`);
      // Not a Cloud API institute — could be QR-based, handled by whatsappManager
      return;
    }

    // ── 2. Check blocklist ────────────────────────────────────────────────
    const phoneClean = studentPhone.replace(/[\s\-\+]/g, '');
    if (await isNumberBlocked(institute.id, phoneClean)) {
      console.log(`[Webhook] Blocked number ${studentPhone} — ignoring.`);
      return;
    }

    // ── 3. Save lead ──────────────────────────────────────────────────────
    void upsertLead(institute.id, studentPhone, messageBody);

    // ── 4. Generate AI reply using same engine as QR-based flow ──────────
    const accessToken = institute.whatsapp_access_token ?? process.env.WHATSAPP_API_TOKEN;

    if (!accessToken) {
      console.warn('[Webhook] No access token available — lead saved but no reply sent.');
      return;
    }

    try {
      // Reuse the same getAIReply from whatsappManager.ts
      // This ensures identical AI quality for both QR and Cloud API flows
      const replyText = await getAIReply(institute.id, studentPhone, messageBody);

      if (replyText) {
        await sendWhatsAppMessage(businessPhoneId, studentPhone, replyText, accessToken);
        console.log(`[Webhook] ✅ AI reply sent to ${studentPhone}`);
      } else {
        console.error('[Webhook] AI returned null — no reply sent.');
      }
    } catch (aiErr) {
      console.error('[Webhook] AI reply failed, sending fallback:', aiErr);
      const fallback =
        `Hi! Thank you for contacting ${institute.name}. ` +
        `We have received your message and will get back to you shortly.`;
      try {
        await sendWhatsAppMessage(businessPhoneId, studentPhone, fallback, accessToken);
      } catch (fallbackErr) {
        console.error('[Webhook] Fallback send also failed:', fallbackErr);
      }
    }
  } catch (err) {
    console.error('[Webhook] Processing error:', err);
  }
});

export default router;