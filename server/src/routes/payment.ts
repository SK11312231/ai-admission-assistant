// routes/payment.ts
// Razorpay payment integration for InquiAI
//
// Required Railway environment variables:
//   RAZORPAY_KEY_ID      — from Razorpay Dashboard → API Keys
//   RAZORPAY_KEY_SECRET  — from Razorpay Dashboard → API Keys
//   CLIENT_URL           — e.g. https://inquiai.in (for redirect URLs)
//
// Mount in index.ts:
//   import paymentRouter from './routes/payment';
//   app.use('/api/payment', defaultLimiter, paymentRouter);

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db';
import { sendPaymentConfirmationEmail, sendPaymentAdminNotificationEmail, sendWelcomeEmail, sendInvoiceEmail } from './emailService';

const router = Router();

// ── Plan pricing config (source of truth — matches DB plans table) ────────────
export const PLAN_PRICING = {
  starter: { monthly: 2499, annual: 24990 },
  growth:  { monthly: 3999, annual: 39990 },
  pro:     { monthly: 8999, annual: 89990 },
} as const;

type PlanSlug    = keyof typeof PLAN_PRICING;
type BillingCycle = 'monthly' | 'annual';

// ── Razorpay helpers ──────────────────────────────────────────────────────────

function getRazorpayAuth(): string {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('Razorpay credentials not configured.');
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

async function createRazorpayOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': getRazorpayAuth(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount:   amountPaise,        // Razorpay uses paise (1 INR = 100 paise)
      currency: 'INR',
      receipt,
      notes,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Razorpay order creation failed: ${err}`);
  }

  return res.json() as Promise<{ id: string; amount: number; currency: string; receipt: string }>;
}

function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';
  const body      = `${orderId}|${paymentId}`;
  const expected  = crypto.createHmac('sha256', keySecret).update(body).digest('hex');
  return expected === signature;
}

// ── POST /api/payment/create-order ───────────────────────────────────────────
// Called by Dashboard when institute clicks "Pay & Upgrade"
// Returns a Razorpay order_id that frontend uses to open checkout

router.post('/create-order', async (req: Request, res: Response) => {
  const { institute_id, plan, billing_cycle } = req.body as {
    institute_id?: number;
    plan?: string;
    billing_cycle?: string;
  };

  if (!institute_id || typeof institute_id !== 'number') {
    res.status(400).json({ error: 'institute_id is required.' });
    return;
  }
  if (!plan || !['starter', 'growth', 'pro'].includes(plan)) {
    res.status(400).json({ error: 'plan must be starter, growth, or pro.' });
    return;
  }
  if (!billing_cycle || !['monthly', 'annual'].includes(billing_cycle)) {
    res.status(400).json({ error: 'billing_cycle must be monthly or annual.' });
    return;
  }

  try {
    // Verify institute exists
    const instResult = await pool.query(
      'SELECT id, name, email, plan FROM institutes WHERE id = $1 AND is_active = TRUE',
      [institute_id],
    );
    const institute = instResult.rows[0] as { id: number; name: string; email: string; plan: string } | undefined;
    if (!institute) {
      res.status(404).json({ error: 'Institute not found.' });
      return;
    }

    const pricing     = PLAN_PRICING[plan as PlanSlug];
    const amountINR   = billing_cycle === 'annual' ? pricing.annual : pricing.monthly;
    const amountPaise = amountINR * 100;
    const receipt     = `inst_${institute_id}_${plan}_${billing_cycle}_${Date.now()}`;

    const order = await createRazorpayOrder(amountPaise, receipt, {
      institute_id: String(institute_id),
      institute_name: institute.name,
      plan,
      billing_cycle,
    });

    // Save pending payment record
    await pool.query(
      `INSERT INTO payments
         (institute_id, razorpay_order_id, plan, billing_cycle, amount_inr, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (razorpay_order_id) DO NOTHING`,
      [institute_id, order.id, plan, billing_cycle, amountINR],
    );

    res.json({
      order_id:       order.id,
      amount:         amountPaise,
      currency:       'INR',
      key_id:         process.env.RAZORPAY_KEY_ID,
      institute_name: institute.name,
      institute_email: institute.email,
      plan,
      billing_cycle,
    });
  } catch (err) {
    console.error('[Payment] create-order error:', err);
    res.status(500).json({ error: 'Failed to create payment order.' });
  }
});

// ── POST /api/payment/verify ──────────────────────────────────────────────────
// Called by frontend after Razorpay checkout success
// Verifies signature → upgrades plan → sends emails

router.post('/verify', async (req: Request, res: Response) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    institute_id,
  } = req.body as {
    razorpay_order_id?:  string;
    razorpay_payment_id?: string;
    razorpay_signature?:  string;
    institute_id?:        number;
  };

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !institute_id) {
    res.status(400).json({ error: 'Missing required payment verification fields.' });
    return;
  }

  // Verify Razorpay signature
  const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!isValid) {
    console.error(`[Payment] Invalid signature for order ${razorpay_order_id}`);
    res.status(400).json({ error: 'Invalid payment signature. Payment not verified.' });
    return;
  }

  try {
    // Get pending payment record
    const payResult = await pool.query(
      `SELECT * FROM payments WHERE razorpay_order_id = $1 AND institute_id = $2`,
      [razorpay_order_id, institute_id],
    );
    const payment = payResult.rows[0] as {
      id: number; institute_id: number; plan: string;
      billing_cycle: string; amount_inr: number;
    } | undefined;

    if (!payment) {
      res.status(404).json({ error: 'Payment record not found.' });
      return;
    }

    // Mark payment as successful + save payment_id
    await pool.query(
      `UPDATE payments
       SET status = 'success', razorpay_payment_id = $1, paid_at = NOW()
       WHERE razorpay_order_id = $2`,
      [razorpay_payment_id, razorpay_order_id],
    );

    // Calculate plan expiry
    const expiresAt = new Date();
    if (payment.billing_cycle === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    // Upsert subscription record
    await pool.query(
      `INSERT INTO subscriptions
         (institute_id, plan, billing_cycle, amount_inr, started_at, expires_at,
          razorpay_order_id, razorpay_payment_id, status)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, 'active')
       ON CONFLICT (institute_id)
       DO UPDATE SET
         plan                = EXCLUDED.plan,
         billing_cycle       = EXCLUDED.billing_cycle,
         amount_inr          = EXCLUDED.amount_inr,
         started_at          = NOW(),
         expires_at          = EXCLUDED.expires_at,
         razorpay_order_id   = EXCLUDED.razorpay_order_id,
         razorpay_payment_id = EXCLUDED.razorpay_payment_id,
         status              = 'active',
         updated_at          = NOW()`,
      [
        institute_id, payment.plan, payment.billing_cycle,
        payment.amount_inr, expiresAt,
        razorpay_order_id, razorpay_payment_id,
      ],
    );

    // Upgrade institute plan + mark as paid
    // is_premium_accessible only set for Growth/Pro — Starter never gets premium features
    const isPremiumPlan = ['growth', 'pro'].includes(payment.plan);
    await pool.query(
      'UPDATE institutes SET plan = $1, is_paid = TRUE, is_premium_accessible = $2, pro_onboarded = FALSE WHERE id = $3',
      [payment.plan, isPremiumPlan, institute_id],
    );

    // Mark any pending upgrade requests as approved
    await pool.query(
      `UPDATE upgrade_requests SET status = 'approved', resolved_at = NOW()
       WHERE institute_id = $1 AND requested_plan = $2 AND status = 'pending'`,
      [institute_id, payment.plan],
    );

    // Fetch institute for emails
    const instResult = await pool.query(
      'SELECT name, email, phone FROM institutes WHERE id = $1',
      [institute_id],
    );
    const inst = instResult.rows[0] as { name: string; email: string; phone: string };

    const planLabel    = payment.plan.charAt(0).toUpperCase() + payment.plan.slice(1);
    const cycleLabel   = payment.billing_cycle === 'annual' ? 'Annual' : 'Monthly';
    const amountFormatted = `₹${payment.amount_inr.toLocaleString('en-IN')}`;

    // Send welcome email if this is first payment (institute was is_paid = false before)
    void sendWelcomeEmail({
      toEmail: inst.email,
      instituteName: inst.name,
    }).catch(e => console.error('[Payment] Welcome email failed:', e));

    // Send invoice email to institute
    void sendInvoiceEmail({
      toEmail:       inst.email,
      instituteName: inst.name,
      plan:          planLabel,
      billingCycle:  cycleLabel,
      amount:        amountFormatted,
      paymentId:     razorpay_payment_id,
      orderId:       razorpay_order_id,
      expiresAt:     expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
    }).catch(e => console.error('[Payment] Invoice email failed:', e));

    // Send payment confirmation email to institute
    void sendPaymentConfirmationEmail({
      toEmail:      inst.email,
      instituteName: inst.name,
      plan:         planLabel,
      billingCycle: cycleLabel,
      amount:       amountFormatted,
      expiresAt:    expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
      paymentId:    razorpay_payment_id,
    }).catch(e => console.error('[Payment] Confirmation email failed:', e));

    // Notify admin
    const adminEmail = process.env.ADMIN_EMAIL ?? process.env.EMAIL_USER ?? '';
    if (adminEmail) {
      void sendPaymentAdminNotificationEmail({
        adminEmail,
        instituteName: inst.name,
        instituteEmail: inst.email,
        institutePhone: inst.phone,
        plan:         planLabel,
        billingCycle: cycleLabel,
        amount:       amountFormatted,
        paymentId:    razorpay_payment_id,
        orderId:      razorpay_order_id,
      }).catch(e => console.error('[Payment] Admin notification email failed:', e));
    }

    console.log(`[Payment] ✅ Success — institute ${institute_id} upgraded to ${payment.plan} (${payment.billing_cycle})`);

    res.json({
      success:      true,
      plan:         payment.plan,
      billing_cycle: payment.billing_cycle,
      expires_at:   expiresAt.toISOString(),
      payment_id:   razorpay_payment_id,
    });
  } catch (err) {
    console.error('[Payment] verify error:', err);
    res.status(500).json({ error: 'Payment verified but plan upgrade failed. Contact support.' });
  }
});

// ── POST /api/payment/webhook ─────────────────────────────────────────────────
// Razorpay webhook endpoint (backup — handles cases where frontend verify fails)
// Register this URL in Razorpay Dashboard → Webhooks:
//   https://inquiai.in/api/payment/webhook
// Events to enable: payment.captured, payment.failed

router.post('/webhook', async (req: Request, res: Response) => {
  const signature   = req.headers['x-razorpay-signature'] as string;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';

  // Verify webhook signature
  if (webhookSecret) {
    const body     = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    if (expected !== signature) {
      console.warn('[Webhook] Invalid Razorpay webhook signature.');
      res.status(400).json({ error: 'Invalid signature.' });
      return;
    }
  }

  const event   = (req.body as { event?: string }).event;
  const payload = (req.body as { payload?: { payment?: { entity?: Record<string, unknown> } } }).payload;
  const payment = payload?.payment?.entity;

  res.json({ received: true }); // Always ACK immediately

  if (!payment) return;

  const orderId   = payment['order_id']  as string | undefined;
  const paymentId = payment['id']        as string | undefined;
  const status    = payment['status']    as string | undefined;

  console.log(`[Webhook] Event: ${event} | Order: ${orderId} | Status: ${status}`);

  if (event === 'payment.captured' && orderId && paymentId) {
    try {
      // Check if already processed by /verify route
      const existing = await pool.query(
        `SELECT status FROM payments WHERE razorpay_order_id = $1`,
        [orderId],
      );
      if (existing.rows[0]?.status === 'success') {
        console.log(`[Webhook] Order ${orderId} already processed — skipping.`);
        return;
      }

      // Process the payment (same as /verify but triggered by webhook)
      await pool.query(
        `UPDATE payments
         SET status = 'success', razorpay_payment_id = $1, paid_at = NOW()
         WHERE razorpay_order_id = $2`,
        [paymentId, orderId],
      );

      const payResult = await pool.query(
        `SELECT * FROM payments WHERE razorpay_order_id = $1`,
        [orderId],
      );
      const payRecord = payResult.rows[0] as {
        institute_id: number; plan: string; billing_cycle: string; amount_inr: number;
      } | undefined;

      if (!payRecord) return;

      const expiresAt = new Date();
      if (payRecord.billing_cycle === 'annual') {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      } else {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      }

      await pool.query(
        `INSERT INTO subscriptions
           (institute_id, plan, billing_cycle, amount_inr, started_at, expires_at,
            razorpay_order_id, razorpay_payment_id, status)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, 'active')
         ON CONFLICT (institute_id)
         DO UPDATE SET
           plan = EXCLUDED.plan, billing_cycle = EXCLUDED.billing_cycle,
           amount_inr = EXCLUDED.amount_inr, started_at = NOW(),
           expires_at = EXCLUDED.expires_at,
           razorpay_order_id = EXCLUDED.razorpay_order_id,
           razorpay_payment_id = EXCLUDED.razorpay_payment_id,
           status = 'active', updated_at = NOW()`,
        [payRecord.institute_id, payRecord.plan, payRecord.billing_cycle,
         payRecord.amount_inr, expiresAt, orderId, paymentId],
      );

      const isPremiumPlan = ['growth', 'pro'].includes(payRecord.plan);
      await pool.query('UPDATE institutes SET plan = $1, is_paid = TRUE, is_premium_accessible = $2 WHERE id = $3',
        [payRecord.plan, isPremiumPlan, payRecord.institute_id]);

      console.log(`[Webhook] ✅ Plan upgraded via webhook — institute ${payRecord.institute_id} → ${payRecord.plan}`);
    } catch (err) {
      console.error('[Webhook] Processing error:', err);
    }
  }

  if (event === 'payment.failed' && orderId) {
    await pool.query(
      `UPDATE payments SET status = 'failed' WHERE razorpay_order_id = $1`,
      [orderId],
    ).catch(err => console.error('[Webhook] Failed to mark payment as failed:', err));
  }
});

// ── GET /api/payment/subscription/:instituteId ────────────────────────────────
// Returns current subscription status for dashboard display

router.get('/subscription/:instituteId', async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  try {
    const result = await pool.query(
      `SELECT plan, billing_cycle, amount_inr, started_at, expires_at, status
       FROM subscriptions WHERE institute_id = $1`,
      [Number(instituteId)],
    );
    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error('[Payment] subscription fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch subscription.' });
  }
});

// ── GET /api/payment/history/:instituteId ────────────────────────────────────
// Returns payment history for an institute

router.get('/history/:instituteId', async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, plan, billing_cycle, amount_inr, status, razorpay_payment_id, paid_at, created_at
       FROM payments
       WHERE institute_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [Number(instituteId)],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Payment] history fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch payment history.' });
  }
});

export default router;