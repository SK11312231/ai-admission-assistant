import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import qrcode from 'qrcode';
import pool from '../db';
import { initSession, getSessionState, getAllSessionStates, disconnectSession } from './whatsappManager';
import { scrapeAndEnrich, getInstituteDetails, scoreProfileCompleteness } from './instituteEnrichment';
import { sendWelcomeEmail, sendPasswordResetEmail, sendEmailVerificationEmail } from './emailService';
import { getLimits, getInstitutePlan } from './planLimits';

// PHONE VERIFICATION — Fast2SMS commented until DLT registration is complete
// async function sendOTPViaSMS(toPhone: string, otp: string): Promise<boolean> {
//   const apiKey = process.env.FAST2SMS_API_KEY;
	
			 
	 
   
					 
					
	   
				 
	 
   
	
				 
	  
	
		
			 
  
	   
	  
		 
		
   
	
					
		
					
	   
  
//   ... (send OTP via Fast2SMS bulkV2 OTP route)
// }
	 
			   
	 
   
 

const router = Router();

interface InstituteRow {
  id: number;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  website: string | null;
  plan: string;
  is_paid: boolean;
  is_premium_accessible: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  password_hash: string;
  created_at: string;
  whatsapp_connected: boolean;
  // From subscriptions JOIN
  subscription_billing_cycle: string | null;
  subscription_expires_at: string | null;
  subscription_status: string | null;
  pro_onboarded: boolean;
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
  const { name, email, phone, whatsapp_number, website, plan, password } = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    whatsapp_number?: string;
    website?: string;
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
  if (!plan || !['starter', 'growth', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Plan must be one of: starter, growth, pro.' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  // website is optional — validate format if provided
  const websiteClean = website && typeof website === 'string' && website.trim() !== ''
    ? website.trim()
    : null;

  try {
    const existing = await pool.query(
      'SELECT id FROM institutes WHERE email = $1 OR whatsapp_number = $2',
      [email.trim().toLowerCase(), whatsapp_number.trim()]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'An institute with this email or WhatsApp number already exists.' });
      return;
    }

    // Ensure the website column exists (safe migration)
    await pool.query(`
      ALTER TABLE institutes ADD COLUMN IF NOT EXISTS website TEXT
    `);

    const passwordHash = hashPassword(password);
    const isPaid = plan === 'starter';
    const isPremiumAccessible = false;

    // Email verification token (24h expiry)
    const emailVerifyToken = crypto.randomBytes(32).toString('hex');
    const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO institutes (name, email, phone, whatsapp_number, website, plan, password_hash,
        is_paid, is_premium_accessible, email_verified, email_verify_token, email_verify_expires, phone_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $11, FALSE) RETURNING id, created_at`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        whatsapp_number.trim(),
        websiteClean,
        plan,
        passwordHash,
        isPaid,
        isPremiumAccessible,
        emailVerifyToken,
        emailVerifyExpires,
      ]
    );

    const newId: number = result.rows[0].id;
    void scrapeAndEnrich(newId, name.trim(), websiteClean);

    // Send email verification (welcome email sent after email is verified)
    const clientUrl = process.env.CLIENT_URL ?? 'https://inquiai.in';
    void sendEmailVerificationEmail({
      toEmail: email.trim().toLowerCase(),
      instituteName: name.trim(),
      verifyUrl: `${clientUrl}/verify-email?token=${emailVerifyToken}`,
    }).catch(err => console.error('[Email] Verification email failed:', err));

    res.status(201).json({
      id: newId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      whatsapp_number: whatsapp_number.trim(),
      website: websiteClean,
      plan,
      is_paid: isPaid,
      is_premium_accessible: isPremiumAccessible,
      email_verified: false,
      phone_verified: false,
      whatsapp_connected: false,
      created_at: result.rows[0].created_at as string,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register institute.' });
  }
});

// ── GET /api/institutes/verify-email?token=xxx ───────────────────────────────
router.get('/verify-email', async (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };
  if (!token) { res.status(400).json({ error: 'Missing token.' }); return; }
  try {
    const result = await pool.query(
      `SELECT id, name, email, email_verified, email_verify_expires
       FROM institutes WHERE email_verify_token = $1 AND is_active = TRUE LIMIT 1`,
      [token],
    );
    const inst = result.rows[0] as {
      id: number; name: string; email: string;
      email_verified: boolean; email_verify_expires: Date;
    } | undefined;
    if (!inst) { res.status(400).json({ error: 'Invalid or expired verification link.' }); return; }
    if (inst.email_verified) { res.json({ success: true, already_verified: true }); return; }
    if (new Date() > new Date(inst.email_verify_expires)) {
      res.status(400).json({ error: 'Verification link has expired. Please request a new one.' }); return;
    }
    await pool.query(
      `UPDATE institutes SET email_verified = TRUE, email_verify_token = NULL, email_verify_expires = NULL WHERE id = $1`,
      [inst.id],
    );
    // Send welcome email now that email is confirmed
    void sendWelcomeEmail({ toEmail: inst.email, instituteName: inst.name })
      .catch(err => console.error('[Email] Welcome email failed:', err));
    console.log(`[Verify] Email verified for institute ${inst.id}`);
    res.json({ success: true, institute_id: inst.id, name: inst.name, email: inst.email });
  } catch (err) {
    console.error('Email verify error:', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

// ── POST /api/institutes/:id/resend-verification-email ───────────────────────
router.post('/:id/resend-verification-email', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(
      `SELECT name, email, email_verified FROM institutes WHERE id = $1 AND is_active = TRUE`, [id],
    );
    const inst = result.rows[0] as { name: string; email: string; email_verified: boolean } | undefined;
    if (!inst) { res.status(404).json({ error: 'Not found.' }); return; }
    if (inst.email_verified) { res.json({ success: true, already_verified: true }); return; }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE institutes SET email_verify_token = $1, email_verify_expires = $2 WHERE id = $3`,
      [token, expires, id],
    );
    const clientUrl = process.env.CLIENT_URL ?? 'https://inquiai.in';
    void sendEmailVerificationEmail({
      toEmail: inst.email, instituteName: inst.name,
      verifyUrl: `${clientUrl}/verify-email?token=${token}`,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resend.' });
  }
});

// PHONE VERIFICATION — route commented until DLT registration is complete
// POST /api/institutes/:id/send-phone-otp
router.post('/:id/send-phone-otp', (_req: Request, res: Response) => {
  // Phone verification via SMS is pending DLT registration
  // Uncomment the full implementation once FAST2SMS_API_KEY and DLT template are ready
  res.status(503).json({ error: 'Phone verification coming soon. DLT registration in progress.' });
						  
   
						 
					   
						

					
				
	  
					   
	   
   

	   
				
	
	   
					  
   
	
  

						
			  
	 
			
				 
   
});

// ── POST /api/institutes/:id/verify-phone-otp ─────────────────────────────────
router.post('/:id/verify-phone-otp', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { otp } = req.body as { otp?: string };
  if (!otp?.trim()) { res.status(400).json({ error: 'OTP is required.' }); return; }
  try {
    const result = await pool.query(
      `SELECT phone_otp, phone_otp_expires, phone_verified, name, email, plan,
              is_paid, is_premium_accessible, whatsapp_number, email_verified, created_at
       FROM institutes WHERE id = $1 AND is_active = TRUE`, [id],
    );
    const inst = result.rows[0] as {
      phone_otp: string | null; phone_otp_expires: Date | null;
      phone_verified: boolean; name: string; email: string; plan: string;
      is_paid: boolean; is_premium_accessible: boolean;
      whatsapp_number: string; email_verified: boolean; created_at: string;
    } | undefined;
    if (!inst) { res.status(404).json({ error: 'Institute not found.' }); return; }
    if (inst.phone_verified) { res.json({ success: true, already_verified: true }); return; }
    if (!inst.phone_otp || inst.phone_otp !== otp.trim()) {
      res.status(400).json({ error: 'Incorrect OTP. Please try again.' }); return;
    }
    if (!inst.phone_otp_expires || new Date() > new Date(inst.phone_otp_expires)) {
      res.status(400).json({ error: 'OTP has expired. Please request a new one.' }); return;
    }
    await pool.query(
      `UPDATE institutes SET phone_verified = TRUE, phone_otp = NULL, phone_otp_expires = NULL WHERE id = $1`, [id],
    );
    console.log(`[Verify] Phone verified for institute ${id}`);
    res.json({
      success: true,
      institute: {
        id, name: inst.name, email: inst.email, plan: inst.plan,
        is_paid: inst.is_paid, is_premium_accessible: inst.is_premium_accessible,
        email_verified: inst.email_verified, phone_verified: true,
        whatsapp_number: inst.whatsapp_number, whatsapp_connected: false,
        created_at: inst.created_at,
      },
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

// POST /api/demo-request
// Receives demo call request from the public demo page and sends email notification.
router.post('/demo-request', async (req: Request, res: Response) => {
  const { name, institute, size, mobile, pilot } = req.body as {
    name?: string;
    institute?: string;
    size?: string;
    mobile?: string;
    pilot?: boolean;
  };

  // Always respond 200 — don't block the WhatsApp redirect
  res.json({ success: true });

  if (!name || !institute || !mobile) return;

  try {
    const { sendDemoRequestEmail } = await import('./emailService');
    const adminEmail = process.env.ADMIN_EMAIL ?? process.env.EMAIL_USER ?? '';
    if (adminEmail) {
      await sendDemoRequestEmail({
        adminEmail,
        name: name.trim(),
        institute: institute.trim(),
        size: size ?? 'Not specified',
        mobile: mobile.trim(),
        pilot: pilot ?? false,
      });
    }
    console.log(`[Demo] Request from ${name} (${institute}) — ${mobile}`);
  } catch (err) {
    console.error('[Demo] Email notification failed:', err);
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
      `SELECT i.*,
              s.billing_cycle        AS subscription_billing_cycle,
              s.expires_at           AS subscription_expires_at,
              s.status               AS subscription_status
       FROM institutes i
       LEFT JOIN subscriptions s ON s.institute_id = i.id
       WHERE i.email = $1 AND i.is_active = TRUE
       ORDER BY s.expires_at DESC NULLS LAST
       LIMIT 1`,
      [email.trim().toLowerCase()]
    );
    const institute = result.rows[0] as InstituteRow | undefined;

    if (!institute || !verifyPassword(password, institute.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // If Growth/Pro institute hasn't paid yet, redirect to complete payment
    if (!institute.is_paid) {
      res.status(402).json({
        error: 'payment_pending',
        message: 'Please complete your payment to access the dashboard.',
        institute: {
          id: institute.id,
          name: institute.name,
          email: institute.email,
          phone: institute.phone,
          whatsapp_number: institute.whatsapp_number,
          website: institute.website ?? null,
          plan: institute.plan,
          is_paid: false,
          is_premium_accessible: false,
          email_verified: institute.email_verified ?? false,
          phone_verified: institute.phone_verified ?? false,
          whatsapp_connected: false,
          created_at: institute.created_at,
          subscription_billing_cycle: null,
          subscription_expires_at: null,
        },
      });
      return;
    }

    res.json({
      id: institute.id,
      name: institute.name,
      email: institute.email,
      phone: institute.phone,
      whatsapp_number: institute.whatsapp_number,
      website: institute.website ?? null,
      plan: institute.plan,
      is_paid: true,
      is_premium_accessible: institute.is_premium_accessible ?? false,
      email_verified: institute.email_verified ?? false,
      phone_verified: institute.phone_verified ?? false,
      whatsapp_connected: institute.whatsapp_connected ?? false,
      created_at: institute.created_at,
      subscription_billing_cycle: institute.subscription_billing_cycle ?? null,
      subscription_expires_at: institute.subscription_expires_at ?? null,
      pro_onboarded: institute.pro_onboarded ?? true,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login.' });
  }
});

// GET /api/institutes/:id/details
// Returns the AI-enriched institute profile data.
router.get('/:id/details', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = await getInstituteDetails(Number(id));
    res.json({ institute_data: data });
  } catch (err) {
    console.error('Get details error:', err);
    res.status(500).json({ error: 'Failed to fetch institute details.' });
  }
});

// PUT /api/institutes/:id/details
// Allows institute to manually update their profile data from the dashboard.
router.put('/:id/details', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { institute_data } = req.body as { institute_data?: string };

  if (!institute_data || typeof institute_data !== 'string' || institute_data.trim() === '') {
    res.status(400).json({ error: 'institute_data is required.' });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO institute_details (institute_id, institute_data, scraped_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (institute_id)
       DO UPDATE SET institute_data = EXCLUDED.institute_data, scraped_at = NOW()`,
      [Number(id), institute_data.trim()],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update details error:', err);
    res.status(500).json({ error: 'Failed to update institute details.' });
  }
});

// POST /api/institutes/:id/re-enrich
// Re-triggers website scraping and AI enrichment (useful if website was updated).
router.post('/:id/re-enrich', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT name, website FROM institutes WHERE id = $1',
      [Number(id)],
    );
    const inst = result.rows[0] as { name: string; website: string | null } | undefined;
    if (!inst) {
      res.status(404).json({ error: 'Institute not found.' });
      return;
    }
    // Fire-and-forget
    void scrapeAndEnrich(Number(id), inst.name, inst.website);
    res.json({ started: true, message: 'Re-enrichment started. Check back in a few seconds.' });
  } catch (err) {
    console.error('Re-enrich error:', err);
    res.status(500).json({ error: 'Failed to start re-enrichment.' });
  }
});

// POST /api/institutes/:id/connect-whatsapp
router.post('/:id/connect-whatsapp', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    void initSession(id);
    res.json({ started: true });
  } catch (err) {
    console.error('Connect WhatsApp error:', err);
    res.status(500).json({ error: 'Failed to start WhatsApp session.' });
  }
});

// GET /api/institutes/:id/whatsapp-status
router.get('/:id/whatsapp-status', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { status, qr } = getSessionState(id);
    let qrDataUrl: string | null = null;
    if (qr) qrDataUrl = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
    res.json({ status, qr: qrDataUrl });
  } catch (err) {
    console.error('WhatsApp status error:', err);
    res.status(500).json({ error: 'Failed to get WhatsApp status.' });
  }
});

// ── Multi-number WhatsApp routes ──────────────────────────────────────────────

// GET /api/institutes/:id/whatsapp-numbers
// Returns all WhatsApp number slots with live session state merged in
router.get('/:id/whatsapp-numbers', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(
      `SELECT id, slot, phone_number, label, is_connected, session_key, created_at
       FROM institute_whatsapp_numbers
       WHERE institute_id = $1
       ORDER BY slot ASC`,
      [id],
    );

    // If table doesn't exist yet / no rows, fall back to single-number from institutes table
    if (result.rows.length === 0) {
      const inst = await pool.query(
        `SELECT whatsapp_number, whatsapp_connected FROM institutes WHERE id = $1`, [id],
      );
      const row = inst.rows[0] as { whatsapp_number: string; whatsapp_connected: boolean } | undefined;
      const liveState = getSessionState(String(id));
      return res.json([{
        id: 0, slot: 1,
        phone_number: row?.whatsapp_number ?? null,
        label: 'Main Number',
        is_connected: row?.whatsapp_connected ?? false,
        status: liveState.status === 'connected' ? 'connected' : (row?.whatsapp_connected ? 'connected' : 'disconnected'),
      }]);
    }

    // Merge in live session state
    const liveStates = getAllSessionStates(String(id));
    const rows = (result.rows as Array<{
      id: number; slot: number; phone_number: string | null;
      label: string; is_connected: boolean; session_key: string;
    }>).map(row => {
      const live = liveStates.find(s => s.slot === row.slot);
      return {
        ...row,
        status: live?.status ?? (row.is_connected ? 'connected' : 'disconnected'),
      };
    });

    res.json(rows);
  } catch (err) {
    console.error('Get WhatsApp numbers error:', err);
    // Table may not exist yet — return synthetic slot 1
    try {
      const inst = await pool.query(
        `SELECT whatsapp_number, whatsapp_connected FROM institutes WHERE id = $1`, [id],
      );
      const row = inst.rows[0] as { whatsapp_number: string; whatsapp_connected: boolean } | undefined;
      const liveState = getSessionState(String(id));
      res.json([{
        id: 0, slot: 1,
        phone_number: row?.whatsapp_number ?? null,
        label: 'Main Number',
        is_connected: row?.whatsapp_connected ?? false,
        status: liveState.status === 'connected' ? 'connected' : (row?.whatsapp_connected ? 'connected' : 'disconnected'),
      }]);
    } catch {
      res.status(500).json({ error: 'Failed to fetch WhatsApp numbers.' });
    }
  }
});

// POST /api/institutes/:id/whatsapp-numbers
// Add a new WhatsApp number slot (plan-limited)
router.post('/:id/whatsapp-numbers', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { label } = req.body as { label?: string };
  try {
    const plan = await getInstitutePlan(id);
    const limits = getLimits(plan);
    const existing = await pool.query(
      `SELECT COUNT(*) AS count FROM institute_whatsapp_numbers WHERE institute_id = $1`, [id],
    );
    const current = Number(existing.rows[0]?.count ?? 0);
    if (limits.whatsapp_numbers !== -1 && current >= limits.whatsapp_numbers) {
      res.status(429).json({
        error: `Your ${plan} plan allows ${limits.whatsapp_numbers} WhatsApp number(s). Upgrade to add more.`,
        code: 'WA_LIMIT_REACHED',
      });
      return;
    }
    const slotResult = await pool.query(
      `SELECT COALESCE(MAX(slot), 0) + 1 AS next_slot FROM institute_whatsapp_numbers WHERE institute_id = $1`, [id],
    );
    const nextSlot = Number(slotResult.rows[0]?.next_slot ?? 2);
    const sessionKey = `${id}-${nextSlot}`;
    const insertResult = await pool.query(
      `INSERT INTO institute_whatsapp_numbers (institute_id, slot, label, is_connected, session_key)
       VALUES ($1, $2, $3, FALSE, $4) RETURNING *`,
      [id, nextSlot, label?.trim() || `WhatsApp ${nextSlot}`, sessionKey],
    );
    res.status(201).json({ ...insertResult.rows[0], slot: nextSlot });
  } catch (err) {
    console.error('Add WhatsApp number error:', err);
    res.status(500).json({ error: 'Failed to add WhatsApp number.' });
  }
});

// POST /api/institutes/:id/whatsapp-numbers/:slot/connect
// Start QR session for a specific slot
router.post('/:id/whatsapp-numbers/:slot/connect', async (req: Request, res: Response) => {
  const id = req.params.id;
  const slot = Number(req.params.slot);
  try {
    void initSession(id, slot);
    res.json({ started: true, sessionKey: `${id}-${slot}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to start WhatsApp session.';
    res.status(400).json({ error: msg });
  }
});

// GET /api/institutes/:id/whatsapp-numbers/:slot/status
// QR + connection status for a specific slot
router.get('/:id/whatsapp-numbers/:slot/status', async (req: Request, res: Response) => {
  const id = req.params.id;
  const slot = Number(req.params.slot);
  try {
    const { status, qr } = getSessionState(id, slot);
    let qrDataUrl: string | null = null;
    if (qr) qrDataUrl = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
    res.json({ status, qr: qrDataUrl });
  } catch (err) {
    console.error(`WhatsApp slot ${slot} status error:`, err);
    res.status(500).json({ error: 'Failed to get status.' });
  }
});

// PATCH /api/institutes/:id/whatsapp-numbers/:slot
// Update label for a slot
router.patch('/:id/whatsapp-numbers/:slot', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const slot = Number(req.params.slot);
  const { label } = req.body as { label?: string };
  if (!label?.trim()) { res.status(400).json({ error: 'Label is required.' }); return; }
  try {
    await pool.query(
      `UPDATE institute_whatsapp_numbers SET label = $1 WHERE institute_id = $2 AND slot = $3`,
      [label.trim(), id, slot],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update label.' });
  }
});

// DELETE /api/institutes/:id/whatsapp-numbers/:slot
// Disconnect and remove a slot (slot 1 = disconnect only, never deleted)
router.delete('/:id/whatsapp-numbers/:slot', async (req: Request, res: Response) => {
  const id = req.params.id;
  const slot = Number(req.params.slot);
  try {
    await disconnectSession(id, slot);
    if (slot > 1) {
      await pool.query(
        `DELETE FROM institute_whatsapp_numbers WHERE institute_id = $1 AND slot = $2`,
        [Number(id), slot],
      );
    } else {
      await pool.query(
        `UPDATE institute_whatsapp_numbers SET is_connected = FALSE WHERE institute_id = $1 AND slot = 1`,
        [Number(id)],
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`Disconnect slot ${slot} error:`, err);
    res.status(500).json({ error: 'Failed to disconnect.' });
  }
});

// PATCH /api/institutes/:id/plan
// Admin-only: directly sets the plan after manual approval of an upgrade request.
router.patch('/:id/plan', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body as { plan?: string };

  if (!plan || !['starter', 'growth', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Plan must be one of: starter, growth, pro.' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE institutes SET plan = $1 WHERE id = $2
       RETURNING id, name, email, phone, whatsapp_number, website, plan, whatsapp_connected`,
      [plan, Number(id)],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Institute not found.' });
      return;
    }

    // Mark any pending upgrade requests for this plan as approved
    
    await pool.query(
      `UPDATE upgrade_requests SET status = 'approved', resolved_at = NOW()
       WHERE institute_id = $1 AND requested_plan = $2 AND status = 'pending'`,
      [Number(id), plan],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan.' });
  }
});

// POST /api/institutes/:id/request-upgrade
// Institute requests a plan upgrade — saves request to DB and notifies admin by email.
router.post('/:id/request-upgrade', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body as { plan?: string };

  if (!plan || !['advanced', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'Requested plan must be advanced or pro.' });
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upgrade_requests (
        id             SERIAL PRIMARY KEY,
        institute_id   INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
        requested_plan TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at    TIMESTAMPTZ
      )
    `);

    // Fetch institute details
    const instResult = await pool.query(
      `SELECT id, name, email, phone, plan FROM institutes WHERE id = $1`,
      [Number(id)],
    );
    const inst = instResult.rows[0] as {
      id: number; name: string; email: string; phone: string; plan: string;
    } | undefined;

    if (!inst) {
      res.status(404).json({ error: 'Institute not found.' });
      return;
    }

    // Don't allow requesting the same or lower plan
    if (inst.plan === plan) {
      res.status(400).json({ error: 'You are already on this plan.' });
      return;
    }

    // Check for existing pending request
    const existing = await pool.query(
      `SELECT id FROM upgrade_requests
       WHERE institute_id = $1 AND requested_plan = $2 AND status = 'pending'`,
      [Number(id), plan],
    );
    if ((existing.rowCount ?? 0) > 0) {
      res.status(409).json({ error: 'An upgrade request for this plan is already pending approval.' });
      return;
    }

    // Insert request record
    const reqResult = await pool.query(
      `INSERT INTO upgrade_requests (institute_id, requested_plan, status)
       VALUES ($1, $2, 'pending') RETURNING id`,
      [Number(id), plan],
    );
    const requestId: number = reqResult.rows[0].id;

    // Email admin
    const { sendUpgradeRequestEmail } = await import('./emailService');
    const adminEmail = process.env.ADMIN_EMAIL ?? process.env.EMAIL_USER ?? '';
    if (adminEmail) {
      void sendUpgradeRequestEmail({
        adminEmail,
        instituteName: inst.name,
        instituteEmail: inst.email,
        institutePhone: inst.phone,
        currentPlan: inst.plan,
        requestedPlan: plan,
        requestId,
      });
    }

    res.status(201).json({ success: true, requestId, status: 'pending' });
  } catch (err) {
    console.error('Request upgrade error:', err);
    res.status(500).json({ error: 'Failed to submit upgrade request.' });
  }
});

// GET /api/institutes/:id/upgrade-request
// Returns the current pending upgrade request for an institute, if any.
router.get('/:id/upgrade-request', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upgrade_requests (
        id             SERIAL PRIMARY KEY,
        institute_id   INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
        requested_plan TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at    TIMESTAMPTZ
      )
    `);

    const result = await pool.query(
      `SELECT id, requested_plan, status, created_at
       FROM upgrade_requests
       WHERE institute_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [Number(id)],
    );

    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error('Get upgrade request error:', err);
    res.status(500).json({ error: 'Failed to fetch upgrade request.' });
  }
});

// ── PATCH /api/institutes/:id/basic-info ──────────────────────────────────────
// Update basic institute info (name, phone, website)
// Email and WhatsApp number are intentionally excluded — those require verification

router.patch('/:id/basic-info', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, phone, website } = req.body as {
    name?: string; phone?: string; website?: string;
  };

  if (!name?.trim()) { res.status(400).json({ error: 'Institute name is required.' }); return; }

  let websiteClean = website?.trim() ?? '';
  if (websiteClean && !websiteClean.startsWith('http')) websiteClean = `https://${websiteClean}`;

  try {
    const result = await pool.query(
      `UPDATE institutes SET name = $1, phone = $2, website = $3 WHERE id = $4
       RETURNING id, name, email, phone, whatsapp_number, website, plan,
                 is_paid, is_premium_accessible, email_verified, phone_verified,
                 whatsapp_connected, created_at`,
      [name.trim(), phone?.trim() ?? '', websiteClean, id],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Institute not found.' }); return; }
    console.log(`[Profile] Basic info updated for institute ${id}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Basic info update error:', err);
    res.status(500).json({ error: 'Failed to update basic info.' });
  }
});

// ── PATCH /api/institutes/:id/business-hours ──────────────────────────────────
// Save business hours JSONB

router.patch('/:id/business-hours', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { business_hours } = req.body as { business_hours?: Record<string, unknown> };
  if (!business_hours || typeof business_hours !== 'object') {
    res.status(400).json({ error: 'business_hours must be an object.' }); return;
  }
  try {
    await pool.query(
      `UPDATE institutes SET business_hours = $1 WHERE id = $2`,
      [JSON.stringify(business_hours), id],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Business hours update error:', err);
    res.status(500).json({ error: 'Failed to update business hours.' });
  }
});

// ── GET /api/institutes/:id/business-hours ────────────────────────────────────

router.get('/:id/business-hours', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(
      `SELECT business_hours FROM institutes WHERE id = $1`, [id],
    );
    res.json({ business_hours: result.rows[0]?.business_hours ?? null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch business hours.' });
  }
});

// ── PATCH /api/institutes/:id/notification-preferences ───────────────────────

router.patch('/:id/notification-preferences', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { notify_new_lead, notify_followup_due, notify_weekly_summary } = req.body as {
    notify_new_lead?: boolean;
    notify_followup_due?: boolean;
    notify_weekly_summary?: boolean;
  };
  try {
    await pool.query(
      `UPDATE institutes
       SET notify_new_lead = COALESCE($1, notify_new_lead),
           notify_followup_due = COALESCE($2, notify_followup_due),
           notify_weekly_summary = COALESCE($3, notify_weekly_summary)
       WHERE id = $4`,
      [
        notify_new_lead ?? null,
        notify_followup_due ?? null,
        notify_weekly_summary ?? null,
        id,
      ],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Notification prefs update error:', err);
    res.status(500).json({ error: 'Failed to update notification preferences.' });
  }
});

// ── GET /api/institutes/:id/notification-preferences ─────────────────────────

router.get('/:id/notification-preferences', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(
      `SELECT notify_new_lead, notify_followup_due, notify_weekly_summary
       FROM institutes WHERE id = $1`, [id],
    );
    res.json(result.rows[0] ?? {
      notify_new_lead: true,
      notify_followup_due: true,
      notify_weekly_summary: false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notification preferences.' });
  }
});

// ── POST /api/institutes/:id/change-password ──────────────────────────────────

router.post('/:id/change-password', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { current_password, new_password } = req.body as {
    current_password?: string; new_password?: string;
  };
  if (!current_password || !new_password) {
    res.status(400).json({ error: 'Both current and new password are required.' }); return;
  }
  if (new_password.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' }); return;
  }
  try {
    const result = await pool.query(
      `SELECT password_hash FROM institutes WHERE id = $1 AND is_active = TRUE`, [id],
    );
    const inst = result.rows[0] as { password_hash: string } | undefined;
    if (!inst) { res.status(404).json({ error: 'Institute not found.' }); return; }
    if (!verifyPassword(current_password, inst.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' }); return;
    }
    const newHash = hashPassword(new_password);
    await pool.query(`UPDATE institutes SET password_hash = $1 WHERE id = $2`, [newHash, id]);
    console.log(`[Profile] Password changed for institute ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// ── GET /api/institutes/:id/invoices ─────────────────────────────────────────
// Returns past successful payments for invoice history page
router.get('/:id/invoices', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.plan,
         p.billing_cycle,
         p.amount_inr,
         p.razorpay_payment_id,
         p.razorpay_order_id,
         p.paid_at,
         p.created_at,
         s.expires_at AS subscription_expires_at
       FROM payments p
       LEFT JOIN subscriptions s
         ON s.institute_id = p.institute_id
         AND s.razorpay_order_id = p.razorpay_order_id
       WHERE p.institute_id = $1 AND p.status = 'success'
       ORDER BY p.paid_at DESC NULLS LAST`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Invoice history error:', err);
    res.status(500).json({ error: 'Failed to fetch invoice history.' });
  }
});

// ── POST /api/institutes/:id/complete-onboarding ──────────────────────────────
// Mark Pro onboarding as completed so the modal doesn't show again

router.post('/:id/complete-onboarding', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await pool.query(
      `UPDATE institutes SET pro_onboarded = TRUE WHERE id = $1`, [id],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed.' });
  }
});

// ── GET/PATCH /api/institutes/:id/persona ─────────────────────────────────────
// Custom AI persona (Pro plan feature)

router.get('/:id/persona', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(
      `SELECT persona_name, persona_tone, language_style FROM institute_personality WHERE institute_id = $1`,
      [id],
    );
    res.json(result.rows[0] ?? { persona_name: null, persona_tone: 'friendly', language_style: 'english' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch persona.' });
  }
});

router.patch('/:id/persona', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { persona_name, persona_tone, language_style } = req.body as {
    persona_name?: string | null;
    persona_tone?: string;
    language_style?: string;
  };

  // Pro plan only
  const plan = await getInstitutePlan(id);
  if (plan !== 'pro') {
    res.status(403).json({ error: 'Custom AI persona is a Pro plan feature.', code: 'PLAN_UPGRADE_REQUIRED' });
    return;
  }

  const VALID_TONES = ['friendly', 'professional', 'enthusiastic', 'concise'];
  const VALID_LANGS = ['english', 'hinglish', 'hindi'];

  if (persona_tone && !VALID_TONES.includes(persona_tone)) {
    res.status(400).json({ error: `Invalid tone. Use: ${VALID_TONES.join(', ')}` }); return;
  }
  if (language_style && !VALID_LANGS.includes(language_style)) {
    res.status(400).json({ error: `Invalid language. Use: ${VALID_LANGS.join(', ')}` }); return;
  }

  try {
    await pool.query(
      `INSERT INTO institute_personality (institute_id, profile, persona_name, persona_tone, language_style, generated_at)
       VALUES ($1, '', $2, $3, $4, NOW())
       ON CONFLICT (institute_id) DO UPDATE SET
         persona_name   = COALESCE(EXCLUDED.persona_name, institute_personality.persona_name),
         persona_tone   = COALESCE(EXCLUDED.persona_tone, institute_personality.persona_tone),
         language_style = COALESCE(EXCLUDED.language_style, institute_personality.language_style)`,
      [id, persona_name?.trim() || null, persona_tone ?? 'friendly', language_style ?? 'english'],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Persona update error:', err);
    res.status(500).json({ error: 'Failed to update persona.' });
  }
});

// DELETE /api/institutes/:id/disconnect-whatsapp
router.delete('/:id/disconnect-whatsapp', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await disconnectSession(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Disconnect WhatsApp error:', err);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp.' });
  }
});

router.post('/:id/clear-session', async (req, res) => {
  const { id } = req.params;
  const fs = await import('fs');
  const path = await import('path');
  const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-institute-${id}`);
  try {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    await pool.query(`UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`, [Number(id)]);
    res.json({ success: true, cleared: sessionPath });
  } catch (err) {
    res.json({ success: false, error: String(err) });
  }
});

// ── Password Reset ────────────────────────────────────────────────────────────

// POST /api/institutes/forgot-password
// Generates a reset token and sends email.
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }

  try {
    // Ensure reset tokens table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id          SERIAL PRIMARY KEY,
        institute_id INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
        token       TEXT NOT NULL UNIQUE,
        expires_at  TIMESTAMPTZ NOT NULL,
        used        BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await pool.query(
      'SELECT id, name, email FROM institutes WHERE email = $1',
      [email.trim().toLowerCase()],
    );
    const institute = result.rows[0] as { id: number; name: string; email: string } | undefined;

    // Always return success to prevent email enumeration attacks
    if (!institute) {
      res.json({ success: true });
      return;
    }

    // Delete any existing unused tokens for this institute
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE institute_id = $1 AND used = FALSE',
      [institute.id],
    );

    // Generate a secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'INSERT INTO password_reset_tokens (institute_id, token, expires_at) VALUES ($1, $2, $3)',
      [institute.id, token, expiresAt],
    );

    void sendPasswordResetEmail({
      toEmail: institute.email,
      instituteName: institute.name,
      resetToken: token,
    }).catch(err => console.error('[Email] Password reset email failed:', err));

    res.json({ success: true });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

// POST /api/institutes/reset-password
// Validates token and sets new password.
router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, password } = req.body as { token?: string; password?: string };

  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Reset token is required.' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT t.id, t.institute_id, t.expires_at, t.used
       FROM password_reset_tokens t
       WHERE t.token = $1`,
      [token],
    );

    const row = result.rows[0] as {
      id: number; institute_id: number; expires_at: string; used: boolean;
    } | undefined;

    if (!row) {
      res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
      return;
    }
    if (row.used) {
      res.status(400).json({ error: 'This reset link has already been used. Please request a new one.' });
      return;
    }
    if (new Date(row.expires_at) < new Date()) {
      res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
      return;
    }

    // Hash and save new password
    const passwordHash = hashPassword(password);
    await pool.query(
      'UPDATE institutes SET password_hash = $1 WHERE id = $2',
      [passwordHash, row.institute_id],
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used = TRUE WHERE id = $1',
      [row.id],
    );

    console.log(`[Auth] Password reset successful for institute ${row.institute_id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// GET /api/institutes/verify-reset-token/:token
// Checks if a reset token is valid before showing the reset form.
router.get('/verify-reset-token/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  try {
    const result = await pool.query(
      `SELECT expires_at, used FROM password_reset_tokens WHERE token = $1`,
      [token],
    );
    const row = result.rows[0] as { expires_at: string; used: boolean } | undefined;

    if (!row || row.used || new Date(row.expires_at) < new Date()) {
      res.json({ valid: false });
      return;
    }
    res.json({ valid: true });
  } catch {
    res.json({ valid: false });
  }
});

router.post('/:id/clear-all-sessions', async (req, res) => {
  const { id } = req.params;
  const fs = await import('fs');
  const path = await import('path');
  // Clear old whatsapp-web.js auth
  const oldPath = path.join(process.cwd(), '.wwebjs_auth', `session-institute-${id}`);
  // Clear new Baileys auth
  const newPath = path.join(process.cwd(), '.baileys_auth', `institute-${id}`);
  fs.rmSync(oldPath, { recursive: true, force: true });
  fs.rmSync(newPath, { recursive: true, force: true });
  await pool.query(`UPDATE institutes SET whatsapp_connected = FALSE WHERE id = $1`, [Number(id)]);
  res.json({ success: true });
});

// GET /api/institutes/:id/profile-completeness

// Returns a completeness score for the institute's AI knowledge base.
router.get('/:id/profile-completeness', async (req: Request, res: Response) => {
  const instituteId = Number(req.params.id);
  if (!instituteId) {
    res.status(400).json({ error: 'Invalid ID.' });
    return;
  }
  try {
    const data = await getInstituteDetails(instituteId);
    const result = scoreProfileCompleteness(data);
    res.json(result);
  } catch (err) {
    console.error('[Completeness] Failed:', err);
    res.status(500).json({ error: 'Failed to check profile completeness.' });
  }
});

export default router;