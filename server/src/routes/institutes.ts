import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db';

const router = Router();

interface InstituteRow {
  id: number;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  plan: string;
  password_hash: string;
  created_at: string;
  whatsapp_connected: boolean;
}

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const computed = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return computed === hash;
}

// POST /api/institutes/register
router.post('/register', async (req: Request, res: Response) => {
  const { name, email, phone, whatsapp_number, plan, password } = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    whatsapp_number?: string;
    plan?: string;
    password?: string;
  };

  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: 'Institute name is required.' });
    return;
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }
  if (!phone || typeof phone !== 'string' || phone.trim() === '') {
    res.status(400).json({ error: 'Phone number is required.' });
    return;
  }
  if (!whatsapp_number || typeof whatsapp_number !== 'string' || whatsapp_number.trim() === '') {
    res.status(400).json({ error: 'WhatsApp number is required.' });
    return;
  }
  if (!plan || !['free', 'advance', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Plan must be one of: free, advance, pro.' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM institutes WHERE email = $1 OR whatsapp_number = $2',
      [email.trim().toLowerCase(), whatsapp_number.trim()]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'An institute with this email or WhatsApp number already exists.' });
      return;
    }

    const passwordHash = hashPassword(password);
    const result = await pool.query(
      `INSERT INTO institutes (name, email, phone, whatsapp_number, plan, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name.trim(), email.trim().toLowerCase(), phone.trim(), whatsapp_number.trim(), plan, passwordHash]
    );

    res.status(201).json({
      id: result.rows[0].id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      whatsapp_number: whatsapp_number.trim(),
      plan,
      whatsapp_connected: false,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register institute.' });
  }
});

// POST /api/institutes/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: 'Password is required.' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT * FROM institutes WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const institute = result.rows[0] as InstituteRow | undefined;

    if (!institute || !verifyPassword(password, institute.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    res.json({
      id: institute.id,
      name: institute.name,
      email: institute.email,
      phone: institute.phone,
      whatsapp_number: institute.whatsapp_number,
      plan: institute.plan,
      whatsapp_connected: institute.whatsapp_connected ?? false,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login.' });
  }
});

// POST /api/institutes/:id/connect-whatsapp
// Primary path: receive OAuth `code` from FB.login callback and exchange it for an access token.
// Secondary path: receive wabaId + phoneNumberId directly from WA_EMBEDDED_SIGNUP FINISH postMessage.
router.post('/:id/connect-whatsapp', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { code, wabaId, phoneNumberId } = req.body as {
    code?: string;
    wabaId?: string;
    phoneNumberId?: string;
  };

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    res.status(500).json({ error: 'META_APP_ID and META_APP_SECRET are not configured.' });
    return;
  }

  try {
    let accessToken: string;
    let resolvedWabaId: string;
    let resolvedPhoneNumberId: string;
    let displayPhoneNumber: string;

    if (code && typeof code === 'string') {
      // ── Primary path: exchange code for access token (no redirect_uri) ──────
      const tokenParams = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: process.env.CLIENT_URL?.replace(/\/$/, '') + '/',
      });

      const tokenRes = await fetch('https://graph.facebook.com/v21.0/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      });
      const tokenData = await tokenRes.json() as {
        access_token?: string;
        error?: { message: string };
      };

      console.log('Token exchange response:', JSON.stringify(tokenData));

      if (!tokenRes.ok || !tokenData.access_token) {
        res.status(400).json({ error: tokenData.error?.message ?? 'Failed to exchange code for access token.' });
        return;
      }

      accessToken = tokenData.access_token;

      // Get WABA ID via debug_token → granular_scopes
      const debugRes = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
      );
      const debugData = await debugRes.json() as {
        data?: {
          granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
        };
        error?: { message: string };
      };

      console.log('debug_token response:', JSON.stringify(debugData));

      if (!debugRes.ok || debugData.error) {
        res.status(400).json({ error: debugData.error?.message ?? 'Failed to inspect access token.' });
        return;
      }

      const wabaScope = debugData.data?.granular_scopes?.find(
        (s) => s.scope === 'whatsapp_business_management',
      );
      resolvedWabaId = wabaScope?.target_ids?.[0] ?? '';

      if (!resolvedWabaId) {
        res.status(400).json({ error: 'Could not determine WhatsApp Business Account ID from token.' });
        return;
      }

      // Get phone number details from WABA
      const phoneNumRes = await fetch(
        `https://graph.facebook.com/v21.0/${resolvedWabaId}/phone_numbers?fields=id,display_phone_number`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const phoneNumData = await phoneNumRes.json() as {
        data?: Array<{ id: string; display_phone_number: string }>;
        error?: { message: string };
      };

      console.log('Phone numbers response:', JSON.stringify(phoneNumData));

      if (!phoneNumRes.ok || phoneNumData.error) {
        res.status(400).json({ error: phoneNumData.error?.message ?? 'Failed to fetch phone numbers.' });
        return;
      }

      const phoneEntry = phoneNumData.data?.[0];
      if (!phoneEntry) {
        res.status(400).json({ error: 'No phone numbers found in WhatsApp Business Account.' });
        return;
      }

      resolvedPhoneNumberId = phoneEntry.id;
      displayPhoneNumber = phoneEntry.display_phone_number;
    } else if (wabaId && typeof wabaId === 'string' && phoneNumberId && typeof phoneNumberId === 'string') {
      // ── Secondary path: wabaId + phoneNumberId from FINISH postMessage ────────
      const systemUserToken = process.env.META_SYSTEM_USER_TOKEN;
      if (!systemUserToken) {
        res.status(500).json({ error: 'META_SYSTEM_USER_TOKEN is not configured.' });
        return;
      }

      accessToken = systemUserToken;
      resolvedWabaId = wabaId;
      resolvedPhoneNumberId = phoneNumberId;

      const phoneRes = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=id,display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${systemUserToken}` } },
      );
      const phoneData = await phoneRes.json() as {
        id?: string;
        display_phone_number?: string;
        verified_name?: string;
        error?: { message: string };
      };

      console.log('Phone number fetch response:', JSON.stringify(phoneData));

      if (phoneData.error) {
        res.status(400).json({ error: phoneData.error.message });
        return;
      }

      if (!phoneData.display_phone_number) {
        res.status(400).json({ error: 'Could not fetch phone number details.' });
        return;
      }

      displayPhoneNumber = phoneData.display_phone_number;
    } else {
      res.status(400).json({ error: 'Either code or wabaId+phoneNumberId is required.' });
      return;
    }

    // Subscribe phone number to our webhook
    const subRes = await fetch(
      `https://graph.facebook.com/v21.0/${resolvedPhoneNumberId}/subscribed_apps`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!subRes.ok) {
      const subErr = await subRes.text();
      console.error(`Webhook subscription failed for phone number ${resolvedPhoneNumberId}: ${subErr}`);
      // Non-fatal: proceed with saving
    }

    // Save to DB
    await pool.query(
      `UPDATE institutes
       SET whatsapp_number = $1,
           whatsapp_phone_number_id = $2,
           whatsapp_waba_id = $3,
           whatsapp_access_token = $4,
           whatsapp_connected = TRUE
       WHERE id = $5`,
      [displayPhoneNumber, resolvedPhoneNumberId, resolvedWabaId, accessToken, Number(id)],
    );

    res.json({
      success: true,
      whatsapp_number: displayPhoneNumber,
      phone_number_id: resolvedPhoneNumberId,
      waba_id: resolvedWabaId,
    });
  } catch (err) {
    console.error('WhatsApp connect error:', err);
    res.status(500).json({ error: 'Failed to connect WhatsApp. Please try again.' });
  }
});

export default router;
