import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

interface InstituteRow {
  id: number;
  name: string;
  whatsapp_number: string;
  plan: string;
}

/**
 * WhatsApp Cloud API webhook handler.
 *
 * To enable this integration the institute owner must:
 *   1. Set up a Meta Business App with WhatsApp Business API access.
 *   2. Configure a webhook pointing to POST /api/webhook/whatsapp
 *   3. Add the following environment variables to server/.env:
 *        WHATSAPP_VERIFY_TOKEN   — a custom string used for webhook verification
 *        WHATSAPP_API_TOKEN      — the permanent access token from Meta
 *
 * Incoming messages create a new lead and send an instant auto-reply.
 */

// GET /api/webhook/whatsapp — Meta webhook verification (challenge handshake)
router.get('/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp webhook verified.');
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

// POST /api/webhook/whatsapp — receive incoming WhatsApp messages
router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;

    // WhatsApp Cloud API sends notifications in a specific structure
    const entry = (body.entry as Array<Record<string, unknown>> | undefined)?.[0];
    const changes = (entry?.changes as Array<Record<string, unknown>> | undefined)?.[0];
    const value = changes?.value as Record<string, unknown> | undefined;
    const messages = value?.messages as Array<Record<string, unknown>> | undefined;
    const metadata = value?.metadata as Record<string, unknown> | undefined;

    if (!messages || messages.length === 0) {
      // Not a message event (could be status update, etc.) — acknowledge it
      res.sendStatus(200);
      return;
    }

    const incomingMsg = messages[0];
    const studentPhone = incomingMsg.from as string; // sender's WhatsApp number
    const studentName =
      ((value?.contacts as Array<Record<string, unknown>> | undefined)?.[0]?.profile as Record<string, unknown> | undefined)?.name as string | undefined;
    const messageBody =
      (incomingMsg.text as Record<string, unknown> | undefined)?.body as string ||
      '[non-text message]';

    // The phone_number_id that received the message belongs to one of our registered institutes
    const businessPhoneId = metadata?.phone_number_id as string | undefined;
    const displayPhone = metadata?.display_phone_number as string | undefined;

    // Try to match the receiving WhatsApp number to a registered institute
    let institute: InstituteRow | undefined;
    if (displayPhone) {
      // Normalize: remove any non-digit characters for matching
      const normalized = displayPhone.replace(/\D/g, '');
      const result = await pool.query(
        `SELECT * FROM institutes WHERE REGEXP_REPLACE(whatsapp_number, '[^0-9]', '', 'g') = $1`,
        [normalized]
      );
      institute = result.rows[0] as InstituteRow | undefined;
    }

    if (!institute) {
      console.warn(`No institute found for WhatsApp number: ${displayPhone ?? 'unknown'}`);
      res.sendStatus(200);
      return;
    }

    // Create a lead for this inquiry
    await pool.query(
      `INSERT INTO leads (institute_id, student_name, student_phone, message)
       VALUES ($1, $2, $3, $4)`,
      [institute.id, studentName ?? null, studentPhone, messageBody]
    );

    // Send an auto-reply via WhatsApp Cloud API
    const apiToken = process.env.WHATSAPP_API_TOKEN;
    if (apiToken && businessPhoneId) {
      const replyText =
        `Hi${studentName ? ` ${studentName}` : ''}! Thank you for reaching out to ${institute.name}. ` +
        `We have received your inquiry and our team will get back to you shortly. ` +
        `If you have any urgent questions, feel free to call us.`;

      await fetch(
        `https://graph.facebook.com/v21.0/${businessPhoneId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: studentPhone,
            type: 'text',
            text: { body: replyText },
          }),
        }
      );
    } else {
      console.warn(
        'WHATSAPP_API_TOKEN or phone_number_id is missing — skipping auto-reply. ' +
        'Lead was still captured.'
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    // Always respond 200 so Meta does not retry excessively
    res.sendStatus(200);
  }
});

export default router;
