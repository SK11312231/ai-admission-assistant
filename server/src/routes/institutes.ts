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

// Password hashing using PBKDF2 (designed for password storage, unlike plain SHA-256)
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
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        whatsapp_number.trim(),
        plan,
        passwordHash,
      ]
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

// POST /api/institutes/:id/connect-whatsapp — exchange Embedded Signup code for WhatsApp credentials
router.post('/:id/connect-whatsapp', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { code } = req.body as { code?: string };

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'code is required.' });
    return;
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const systemUserToken = process.env.META_SYSTEM_USER_TOKEN;

  if (!appId || !appSecret) {
    res.status(500).json({ error: 'META_APP_ID and META_APP_SECRET are not configured on the server.' });
    return;
  }

  try {
    // Step 1: Exchange the short-lived code for an access token.
    // When FB.login uses response_type:'code', Meta requires redirect_uri in the
    // token exchange to exactly match the URI used during the OAuth dialogue.
    // For the JS SDK Embedded Signup flow the implicit redirect_uri is always
    // https://www.facebook.com/connect/login_success.html
    // const tokenParams = new URLSearchParams({
    //   client_id: appId,
    //   client_secret: appSecret,
    //   code,
    // });

    const tokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('code', code);

    // ✅ Use the redirect_uri from the frontend (current page URL)
    // if (redirectUri) {
    //   tokenUrl.searchParams.set('redirect_uri', redirectUri);
    // }

    // ADD THIS
    console.log('Token URL being called:', tokenUrl.toString());

    const tokenRes = await fetch(tokenUrl.toString(), {
      method: 'GET', // ✅ Must be GET, not POST
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } };

    // ADD THIS
    console.log('Token exchange response:', JSON.stringify(tokenData));

    if (!tokenData.access_token) {
      const msg = tokenData.error?.message ?? 'Failed to exchange code for access token.';
      res.status(400).json({ error: msg });
      return;
    }
    const userAccessToken = tokenData.access_token;

    // Step 2: Get the WABA ID from debug_token (requires system user token or app token)
    // Note: input_token is a required query parameter per Meta's Graph API spec
    const debugTokenRes = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(userAccessToken)}`,
      {
        headers: {
          Authorization: `Bearer ${systemUserToken ?? `${appId}|${appSecret}`}`,
        },
      }
    );
    const debugData = await debugTokenRes.json() as {
      data?: {
        granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
      };
    };

    const wabaId = debugData.data?.granular_scopes
      ?.find((s) => s.scope === 'whatsapp_business_management')
      ?.target_ids?.[0];

    if (!wabaId) {
      res.status(400).json({ error: 'Could not find WhatsApp Business Account in the granted permissions. Make sure whatsapp_business_management permission was granted.' });
      return;
    }

    // Step 3: Get phone numbers for this WABA
    const phoneRes = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${userAccessToken}` } }
    );
    const phoneData = await phoneRes.json() as {
      data?: Array<{ id: string; display_phone_number: string; verified_name?: string }>;
      error?: { message: string };
    };

    if (!phoneData.data || phoneData.data.length === 0) {
      res.status(400).json({ error: 'No phone numbers found in this WhatsApp Business Account.' });
      return;
    }

    const phone = phoneData.data[0];
    const phoneNumberId = phone.id;
    const displayPhoneNumber = phone.display_phone_number;

    // Step 4: Subscribe this phone number to our webhook
    const subRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/subscribed_apps`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAccessToken}` },
      }
    );
    if (!subRes.ok) {
      const subErr = await subRes.text();
      console.error(`Webhook subscription failed for phone number ${phoneNumberId}: ${subErr}`);
      // Non-fatal: proceed with saving credentials; the institute can retry later
    }

    // Step 5: Save to DB
    await pool.query(
      `UPDATE institutes
       SET whatsapp_number = $1,
           whatsapp_phone_number_id = $2,
           whatsapp_access_token = $3,
           whatsapp_connected = TRUE
       WHERE id = $4`,
      [displayPhoneNumber, phoneNumberId, userAccessToken, Number(id)]
    );

    res.json({
      success: true,
      whatsapp_number: displayPhoneNumber,
      phone_number_id: phoneNumberId,
    });
  } catch (err) {
    console.error('WhatsApp connect error:', err);
    res.status(500).json({ error: 'Failed to connect WhatsApp. Please try again.' });
  }
});

export default router;