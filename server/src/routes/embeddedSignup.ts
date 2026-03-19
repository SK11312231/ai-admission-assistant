import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// ── POST /api/whatsapp/embedded-signup ───────────────────────────────────────
// Called from the frontend after the Meta Embedded Signup flow completes.
// Receives WABA ID, phone number ID, and access token, saves them to the DB.

router.post('/embedded-signup', async (req: Request, res: Response) => {
  const { institute_id, waba_id, phone_number_id, access_token } = req.body as {
    institute_id: number;
    waba_id: string;
    phone_number_id: string;
    access_token: string;
  };

  if (!institute_id || !waba_id || !phone_number_id || !access_token) {
    return res.status(400).json({ error: 'Missing required fields: institute_id, waba_id, phone_number_id, access_token' });
  }

  try {
    await pool.query(
      `UPDATE institutes
       SET whatsapp_waba_id          = $1,
           whatsapp_phone_number_id  = $2,
           whatsapp_access_token     = $3,
           whatsapp_connected        = TRUE
       WHERE id = $4`,
      [waba_id, phone_number_id, access_token, institute_id],
    );

    console.log(`[EmbeddedSignup] ✅ Institute ${institute_id} connected — WABA: ${waba_id}, Phone ID: ${phone_number_id}`);

    // Register the webhook for this WABA via Meta Graph API
    // This subscribes to message events so incoming WhatsApp messages hit our webhook
    const webhookUrl = process.env.WEBHOOK_URL; // e.g. https://your-railway-app.up.railway.app/api/webhook
    if (webhookUrl) {
      try {
        const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN ?? 'inquiai_webhook_token';
        const appId = process.env.META_APP_ID;
        const systemToken = process.env.META_SYSTEM_USER_TOKEN ?? access_token;

        const subscribeRes = await fetch(
          `https://graph.facebook.com/v19.0/${waba_id}/subscribed_apps`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: systemToken,
            }),
          },
        );
        const subscribeData = await subscribeRes.json() as { success?: boolean; error?: { message: string } };
        if (subscribeData.success) {
          console.log(`[EmbeddedSignup] ✅ Webhook subscribed for WABA ${waba_id}`);
        } else {
          console.warn(`[EmbeddedSignup] ⚠️ Webhook subscription response:`, subscribeData);
        }
      } catch (webhookErr) {
        // Non-fatal — credentials are saved, webhook can be retried
        console.error('[EmbeddedSignup] Webhook subscription failed (non-fatal):', webhookErr);
      }
    }

    return res.json({ success: true, message: 'WhatsApp Business Account connected successfully.' });
  } catch (err) {
    console.error('[EmbeddedSignup] DB save failed:', err);
    return res.status(500).json({ error: 'Failed to save WhatsApp connection. Please try again.' });
  }
});

// ── DELETE /api/whatsapp/embedded-signup/:instituteId ────────────────────────
// Disconnects the WhatsApp Business Account for an institute.

router.delete('/embedded-signup/:instituteId', async (req: Request, res: Response) => {
  const instituteId = Number(req.params.instituteId);
  if (!instituteId) return res.status(400).json({ error: 'Invalid institute ID.' });

  try {
    await pool.query(
      `UPDATE institutes
       SET whatsapp_waba_id         = NULL,
           whatsapp_phone_number_id = NULL,
           whatsapp_access_token    = NULL,
           whatsapp_connected       = FALSE
       WHERE id = $1`,
      [instituteId],
    );
    console.log(`[EmbeddedSignup] Disconnected institute ${instituteId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[EmbeddedSignup] Disconnect failed:', err);
    return res.status(500).json({ error: 'Failed to disconnect.' });
  }
});

// ── GET /api/whatsapp/embedded-signup/:instituteId/status ────────────────────
// Returns the current WhatsApp Business API connection status.

router.get('/embedded-signup/:instituteId/status', async (req: Request, res: Response) => {
  const instituteId = Number(req.params.instituteId);
  if (!instituteId) return res.status(400).json({ error: 'Invalid institute ID.' });

  try {
    const result = await pool.query(
      `SELECT whatsapp_connected, whatsapp_waba_id, whatsapp_phone_number_id
       FROM institutes WHERE id = $1`,
      [instituteId],
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Institute not found.' });

    return res.json({
      connected: row.whatsapp_connected as boolean,
      waba_id: row.whatsapp_waba_id as string | null,
      phone_number_id: row.whatsapp_phone_number_id as string | null,
    });
  } catch (err) {
    console.error('[EmbeddedSignup] Status check failed:', err);
    return res.status(500).json({ error: 'Failed to fetch status.' });
  }
});

export default router;
