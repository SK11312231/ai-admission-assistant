// ── SendGrid HTTP API email service ──────────────────────────────────────────
//
// Switched from SendGrid to Resend (resend.com).
// Resend free tier = 3,000 emails/month — much more generous than SendGrid.
// Uses the same HTTPS API pattern, no npm packages needed.
//
// Required Railway environment variables:
//   RESEND_API_KEY   — your Resend API key (starts with re_)
//   SENDGRID_FROM    — verified sender email (reuse existing variable)
//                      Must use a domain you've verified in Resend dashboard.
//                      For quick testing, use: onboarding@resend.dev (Resend's test address)
//                      For production: add your domain at resend.com → Domains

interface MailPayload {
  to: string;
  subject: string;
  html: string;
}

// ── Core send function (pure HTTPS, no nodemailer) ────────────────────────────

async function sendEmail(payload: MailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM ?? process.env.EMAIL_USER;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY environment variable is not set.');
  }
  if (!fromEmail) {
    throw new Error(
      'SENDGRID_FROM environment variable is not set. ' +
      'Set it to a verified sender email in your Resend account.',
    );
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `InquiAI <${fromEmail}>`,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (!response.ok) {
    let details = '';
    try {
      const errBody = await response.json() as { message?: string; name?: string };
      details = errBody.message ?? errBody.name ?? '';
    } catch { /* ignore json parse failure */ }
    throw new Error(`Resend ${response.status}: ${details || response.statusText}`);
  }
}

// ── Base HTML template ────────────────────────────────────────────────────────

function baseTemplate(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:#4f46e5;padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🎓 InquiAI</h1>
            <p style="margin:4px 0 0;color:#c7d2fe;font-size:13px;">AI Admission Assistant</p>
          </td>
        </tr>
        <tr><td style="padding:32px;">${body}</td></tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
              Automated notification from InquiAI. Login to your dashboard to manage leads.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function infoBox(content: string, color = '#4f46e5'): string {
  return `<div style="background:#f5f3ff;border-left:4px solid ${color};border-radius:8px;padding:16px 20px;margin:16px 0;">${content}</div>`;
}

function ctaButton(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin-top:20px;">${text}</a>`;
}

// ── 1. New Lead Notification ──────────────────────────────────────────────────

export async function sendNewLeadEmail(opts: {
  toEmail: string;
  instituteName: string;
  studentName: string | null;
  studentPhone: string;
  message: string;
  dashboardUrl?: string;
}): Promise<void> {
  const {
    toEmail, instituteName, studentName, studentPhone, message,
    dashboardUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;
  const name = studentName ?? 'Unknown Student';

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">🔔 New Lead!</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">A new student enquired via WhatsApp at <strong>${instituteName}</strong>.</p>
    ${infoBox(`
      <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#1f2937;">👤 ${name}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">📱 ${studentPhone}</p>
      <p style="margin:12px 0 4px;font-size:13px;color:#374151;font-style:italic;">"${message.slice(0, 200)}${message.length > 200 ? '…' : ''}"</p>
    `)}
    <p style="color:#6b7280;font-size:13px;">Log in to view the full conversation and manage this lead.</p>
    ${ctaButton('View Lead →', dashboardUrl)}
  `;

  await sendEmail({
    to: toEmail,
    subject: `🔔 New Lead: ${name} enquired at ${instituteName}`,
    html: baseTemplate('New Lead', body),
  });

  console.log(`[Email] New lead email sent to ${toEmail}`);
}

// ── 2. Follow-up Due Today ────────────────────────────────────────────────────

export async function sendFollowUpDueEmail(opts: {
  toEmail: string;
  instituteName: string;
  leads: Array<{ student_name: string | null; student_phone: string; notes: string | null; follow_up_date: string }>;
  dashboardUrl?: string;
}): Promise<void> {
  const {
    toEmail, instituteName, leads,
    dashboardUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;
  if (leads.length === 0) return;

  const leadRows = leads.map(l => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#1f2937;font-weight:500;">${l.student_name ?? 'Unknown'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;">${l.student_phone}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;">${l.notes ? l.notes.slice(0, 60) + (l.notes.length > 60 ? '…' : '') : '—'}</td>
    </tr>
  `).join('');

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">📅 Follow-ups Due Today</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">You have <strong>${leads.length} follow-up${leads.length > 1 ? 's' : ''}</strong> scheduled for today at <strong>${instituteName}</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Student</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Phone</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Notes</th>
        </tr>
      </thead>
      <tbody>${leadRows}</tbody>
    </table>
    ${ctaButton('Open Dashboard →', dashboardUrl)}
  `;

  await sendEmail({
    to: toEmail,
    subject: `📅 ${leads.length} Follow-up${leads.length > 1 ? 's' : ''} Due Today — ${instituteName}`,
    html: baseTemplate('Follow-ups Due Today', body),
  });

  console.log(`[Email] Follow-up due email sent to ${toEmail} (${leads.length} leads)`);
}

// ── 3. 24h No-Reply Reminder ──────────────────────────────────────────────────

export async function sendNoReplyReminderEmail(opts: {
  toEmail: string;
  instituteName: string;
  leads: Array<{ student_name: string | null; student_phone: string; message: string; last_activity_at: string }>;
  dashboardUrl?: string;
}): Promise<void> {
  const {
    toEmail, instituteName, leads,
    dashboardUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;
  if (leads.length === 0) return;

  const leadRows = leads.map(l => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#1f2937;font-weight:500;">${l.student_name ?? 'Unknown'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;">${l.student_phone}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;font-style:italic;">"${l.message.slice(0, 80)}${l.message.length > 80 ? '…' : ''}"</td>
    </tr>
  `).join('');

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">💤 Students Haven't Replied in 24h</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;"><strong>${leads.length} student${leads.length > 1 ? 's' : ''}</strong> at <strong>${instituteName}</strong> haven't responded in over 24 hours.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Student</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Phone</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Last Message</th>
        </tr>
      </thead>
      <tbody>${leadRows}</tbody>
    </table>
    ${ctaButton('Send Follow-ups →', dashboardUrl)}
  `;

  await sendEmail({
    to: toEmail,
    subject: `💤 ${leads.length} Student${leads.length > 1 ? 's' : ''} Haven't Replied — ${instituteName}`,
    html: baseTemplate('No Reply Reminder', body),
  });

  console.log(`[Email] No-reply reminder sent to ${toEmail} (${leads.length} leads)`);
}

// ── 4. Weekly Summary ─────────────────────────────────────────────────────────

export async function sendWeeklySummaryEmail(opts: {
  toEmail: string;
  instituteName: string;
  totalLeads: number;
  newThisWeek: number;
  contacted: number;
  converted: number;
  lost: number;
  conversionRate: string;
  dashboardUrl?: string;
}): Promise<void> {
  const {
    toEmail, instituteName, totalLeads, newThisWeek, contacted, converted, lost,
    conversionRate, dashboardUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;

  function statBox(emoji: string, label: string, value: number | string, bg: string, color: string): string {
    return `
      <td style="padding:4px;" width="25%">
        <div style="background:${bg};border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:22px;">${emoji}</div>
          <div style="font-size:22px;font-weight:700;color:${color};margin:4px 0;">${value}</div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;">${label}</div>
        </div>
      </td>`;
  }

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">📊 Weekly Summary</h2>
    <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Here's how <strong>${instituteName}</strong> performed this week.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        ${statBox('👥', 'Total Leads', totalLeads, '#f5f3ff', '#4f46e5')}
        ${statBox('🆕', 'New This Week', newThisWeek, '#ecfdf5', '#059669')}
        ${statBox('✅', 'Converted', converted, '#fef3c7', '#d97706')}
        ${statBox('📈', 'Conv. Rate', conversionRate, '#eff6ff', '#2563eb')}
      </tr>
    </table>
    ${infoBox(`
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Lead Status Breakdown</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">🆕 New: <strong>${newThisWeek}</strong> &nbsp;|&nbsp; 📞 Contacted: <strong>${contacted}</strong> &nbsp;|&nbsp; ✅ Converted: <strong>${converted}</strong> &nbsp;|&nbsp; ❌ Lost: <strong>${lost}</strong></p>
    `, '#6366f1')}
    ${ctaButton('View Full Dashboard →', dashboardUrl)}
  `;

  await sendEmail({
    to: toEmail,
    subject: `📊 Weekly Summary — ${instituteName} (${newThisWeek} new leads this week)`,
    html: baseTemplate('Weekly Summary', body),
  });

  console.log(`[Email] Weekly summary sent to ${toEmail}`);
}

// ── 6. Welcome Email (post-registration) ─────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  toEmail: string;
  instituteName: string;
  dashboardUrl?: string;
}): Promise<void> {
  const {
    toEmail, instituteName,
    dashboardUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">👋 Welcome to InquiAI, ${instituteName}!</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">
      Your account is ready. You're on a <strong>30-day free trial</strong> with full access to all features.
    </p>

    ${infoBox(`
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1f2937;">🚀 Get started in 3 steps</p>
      <p style="margin:0 0 10px;font-size:13px;color:#374151;">
        <strong>1. Connect WhatsApp</strong> — Go to your dashboard → WhatsApp tab → scan the QR code with your institute's WhatsApp number.
      </p>
      <p style="margin:0 0 10px;font-size:13px;color:#374151;">
        <strong>2. Complete your profile</strong> — Add your courses, fees, and contact details so the AI can answer student queries accurately.
      </p>
      <p style="margin:0;font-size:13px;color:#374151;">
        <strong>3. Share your number</strong> — Start sharing your WhatsApp number with prospective students. Every inquiry will be auto-replied and captured as a lead.
      </p>
    `)}

    <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin:16px 0;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#374151;">✅ What's included in your trial</p>
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.8;">
        Unlimited leads · AI auto-replies 24/7 · Lead dashboard · Analytics · Chat widget · AI Training · Follow-up management
      </p>
    </div>

    <p style="color:#6b7280;font-size:13px;margin-top:16px;">
      Need help? Reply to this email or WhatsApp us anytime.
    </p>
    ${ctaButton('Open Your Dashboard →', dashboardUrl)}
  `;

  await sendEmail({
    to: toEmail,
    subject: `🎉 Welcome to InquiAI — Your 30-day trial has started!`,
    html: baseTemplate('Welcome to InquiAI', body),
  });

  console.log(`[Email] Welcome email sent to ${toEmail}`);
}

// ── 7. Password Reset ─────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(opts: {
  toEmail: string;
  instituteName: string;
  resetToken: string;
  resetUrl?: string;
}): Promise<void> {
  const {
    toEmail, instituteName, resetToken,
    resetUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;

  const resetLink = `${resetUrl}/reset-password?token=${resetToken}`;

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">🔑 Reset Your Password</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">
      We received a request to reset the password for <strong>${instituteName}</strong>.
      Click the button below to set a new password.
    </p>

    ${ctaButton('Reset Password →', resetLink)}

    ${infoBox(`
      <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#92400e;">⏰ This link expires in 1 hour</p>
      <p style="margin:0;font-size:13px;color:#92400e;">If you didn't request a password reset, you can safely ignore this email.</p>
    `, '#f59e0b')}

    <p style="color:#9ca3af;font-size:12px;margin-top:20px;word-break:break-all;">
      If the button doesn't work, copy this link: ${resetLink}
    </p>
  `;

  await sendEmail({
    to: toEmail,
    subject: `🔑 Reset your InquiAI password`,
    html: baseTemplate('Reset Password', body),
  });

  console.log(`[Email] Password reset email sent to ${toEmail}`);
}

export async function sendUpgradeRequestEmail(opts: {
  adminEmail: string;
  instituteName: string;
  instituteEmail: string;
  institutePhone: string;
  currentPlan: string;
  requestedPlan: string;
  requestId: number;
  dashboardUrl?: string;
}): Promise<void> {
  const {
    adminEmail, instituteName, instituteEmail, institutePhone,
    currentPlan, requestedPlan, requestId,
    dashboardUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;

  const planLabel = requestedPlan.charAt(0).toUpperCase() + requestedPlan.slice(1);
  const currentLabel = currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1);

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">⬆️ Plan Upgrade Request</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">An institute has requested to upgrade. Please review and approve.</p>
    ${infoBox(`
      <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#1f2937;">🏫 ${instituteName}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">📧 ${instituteEmail}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">📱 ${institutePhone}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Request ID: <strong>#${requestId}</strong></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
      <p style="margin:0 0 4px;font-size:13px;color:#374151;">
        Current: <span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-weight:600;">${currentLabel}</span>
      </p>
      <p style="margin:8px 0 0;font-size:14px;color:#374151;">
        Requested: <span style="background:#ede9fe;color:#4f46e5;padding:2px 8px;border-radius:4px;font-weight:700;">${planLabel}</span>
      </p>
    `, '#f59e0b')}
    <p style="color:#6b7280;font-size:13px;margin-top:20px;">To approve, update the plan via API:</p>
    <div style="background:#1f2937;border-radius:8px;padding:14px 18px;margin:12px 0;">
      <code style="color:#a5f3fc;font-size:12px;font-family:monospace;">
        PATCH /api/institutes/&lt;id&gt;/plan  →  { "plan": "${requestedPlan}" }
      </code>
    </div>
    ${ctaButton('Open Dashboard →', dashboardUrl)}
  `;

  await sendEmail({
    to: adminEmail,
    subject: `⬆️ Upgrade Request: ${instituteName} → ${planLabel} Plan`,
    html: baseTemplate('Plan Upgrade Request', body),
  });

  console.log(`[Email] Upgrade request sent to ${adminEmail} for: ${instituteName}`);
}
// ── 8. Demo Request Notification ─────────────────────────────────────────────

export async function sendDemoRequestEmail(opts: {
  adminEmail: string;
  name: string;
  institute: string;
  size: string;
  mobile: string;
  pilot: boolean;
}): Promise<void> {
  const { adminEmail, name, institute, size, mobile, pilot } = opts;

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">📞 New Demo Request</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">Someone requested a call from the InquiAI demo page.</p>
    ${infoBox(`
      <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#1f2937;">🏫 ${institute}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#374151;">👤 <strong>Name:</strong> ${name}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#374151;">📱 <strong>Mobile:</strong> ${mobile}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#374151;">👥 <strong>Institute Size:</strong> ${size}</p>
      <p style="margin:0;font-size:13px;color:#374151;">🎯 <strong>Free Pilot:</strong> ${pilot ? 'Yes, interested ✅' : 'Not sure yet'}</p>
    `, '#10b981')}
    <p style="color:#6b7280;font-size:13px;margin-top:16px;">Reply to this lead within 2 hours for best conversion.</p>
    ${ctaButton(`WhatsApp ${name} →`, `https://wa.me/91${mobile}`)}
  `;

  await sendEmail({
    to: adminEmail,
    subject: `📞 Demo Request: ${name} from ${institute}`,
    html: baseTemplate('New Demo Request', body),
  });

  console.log(`[Email] Demo request notification sent for: ${name} (${institute})`);
}

// ── 9. Payment Confirmation (to institute) ────────────────────────────────────

export async function sendPaymentConfirmationEmail(opts: {
  toEmail: string;
  instituteName: string;
  plan: string;
  billingCycle: string;
  amount: string;
  expiresAt: string;
  paymentId: string;
  dashboardUrl?: string;
}): Promise<void> {
  const {
    toEmail, instituteName, plan, billingCycle,
    amount, expiresAt, paymentId,
    dashboardUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">🎉 Payment Successful!</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">
      Your InquiAI subscription has been activated. Here are your payment details.
    </p>
    ${infoBox(`
      <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#1f2937;">🏫 ${instituteName}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
      <p style="margin:0 0 6px;font-size:13px;color:#374151;">
        Plan: <span style="background:#ede9fe;color:#4f46e5;padding:2px 8px;border-radius:4px;font-weight:700;">${plan}</span>
      </p>
      <p style="margin:6px 0;font-size:13px;color:#374151;">
        Billing: <strong>${billingCycle}</strong>
      </p>
      <p style="margin:6px 0;font-size:13px;color:#374151;">
        Amount Paid: <strong style="color:#059669;">${amount}</strong>
      </p>
      <p style="margin:6px 0;font-size:13px;color:#374151;">
        Valid Until: <strong>${expiresAt}</strong>
      </p>
      <p style="margin:6px 0 0;font-size:11px;color:#9ca3af;">Payment ID: ${paymentId}</p>
    `, '#059669')}
    <p style="color:#6b7280;font-size:13px;margin-top:16px;">
      All premium features are now unlocked. Visit your dashboard to get started.
    </p>
    ${ctaButton('Go to Dashboard →', `${dashboardUrl}/dashboard`)}
    <p style="color:#9ca3af;font-size:11px;margin-top:20px;">
      Need help? Reply to this email or contact us at support@inquiai.in
    </p>
  `;

  await sendEmail({
    to: toEmail,
    subject: `✅ Payment Confirmed — ${plan} Plan Activated | InquiAI`,
    html: baseTemplate('Payment Confirmation', body),
  });

  console.log(`[Email] Payment confirmation sent to ${toEmail} (${plan} / ${billingCycle})`);
}

// ── 10. Payment Admin Notification ────────────────────────────────────────────

export async function sendPaymentAdminNotificationEmail(opts: {
  adminEmail: string;
  instituteName: string;
  instituteEmail: string;
  institutePhone: string;
  plan: string;
  billingCycle: string;
  amount: string;
  paymentId: string;
  orderId: string;
}): Promise<void> {
  const {
    adminEmail, instituteName, instituteEmail, institutePhone,
    plan, billingCycle, amount, paymentId, orderId,
  } = opts;

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">💰 New Payment Received</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">
      An institute has completed payment and their plan has been automatically upgraded.
    </p>
    ${infoBox(`
      <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#1f2937;">🏫 ${instituteName}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">📧 ${instituteEmail}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">📱 ${institutePhone}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
      <p style="margin:0 0 6px;font-size:13px;color:#374151;">
        Plan: <span style="background:#ede9fe;color:#4f46e5;padding:2px 8px;border-radius:4px;font-weight:700;">${plan}</span>
      </p>
      <p style="margin:6px 0;font-size:13px;color:#374151;">
        Billing: <strong>${billingCycle}</strong>
      </p>
      <p style="margin:6px 0;font-size:13px;color:#374151;">
        Amount: <strong style="color:#059669;">${amount}</strong>
      </p>
      <p style="margin:6px 0;font-size:11px;color:#9ca3af;">Payment ID: ${paymentId}</p>
      <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Order ID: ${orderId}</p>
    `, '#059669')}
    <p style="color:#6b7280;font-size:13px;margin-top:16px;">
      The institute's plan has been automatically upgraded in the database.
    </p>
  `;

  await sendEmail({
    to: adminEmail,
    subject: `💰 New Payment: ${instituteName} → ${plan} (${billingCycle})`,
    html: baseTemplate('Payment Received', body),
  });

  console.log(`[Email] Payment admin notification sent for: ${instituteName}`);
}

// ── 11. Invoice Email (to institute after payment) ────────────────────────────

export async function sendInvoiceEmail(opts: {
  toEmail: string;
  instituteName: string;
  plan: string;
  billingCycle: string;
  amount: string;
  paymentId: string;
  orderId: string;
  expiresAt: string;
  dashboardUrl?: string;
}): Promise<void> {
  const {
    toEmail, instituteName, plan, billingCycle,
    amount, paymentId, orderId, expiresAt,
    dashboardUrl = process.env.CLIENT_URL ?? 'https://inquiai.in',
  } = opts;

  const invoiceDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

  const body = `
    <h2 style="margin:0 0 4px;color:#111827;font-size:20px;">🧾 Invoice from InquiAI</h2>
    <p style="color:#6b7280;margin:0 0 24px;font-size:13px;">Thank you for your payment. Please keep this for your records.</p>

    ${infoBox(`
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Invoice Number</td>
          <td style="padding:6px 0;color:#1f2937;font-weight:600;text-align:right;">${invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Invoice Date</td>
          <td style="padding:6px 0;color:#1f2937;text-align:right;">${invoiceDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Billed To</td>
          <td style="padding:6px 0;color:#1f2937;text-align:right;">${instituteName}</td>
        </tr>
        <tr style="border-top:1px solid #e5e7eb;">
          <td style="padding:12px 0 6px;color:#6b7280;">Description</td>
          <td style="padding:12px 0 6px;color:#1f2937;text-align:right;">InquiAI ${plan} Plan — ${billingCycle}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;">Valid Until</td>
          <td style="padding:6px 0;color:#1f2937;text-align:right;">${expiresAt}</td>
        </tr>
        <tr style="border-top:2px solid #e5e7eb;">
          <td style="padding:12px 0 0;color:#111827;font-weight:700;font-size:15px;">Total Paid</td>
          <td style="padding:12px 0 0;color:#059669;font-weight:800;font-size:18px;text-align:right;">${amount}</td>
        </tr>
      </table>
    `, '#4f46e5')}

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;margin:20px 0;font-size:12px;color:#6b7280;">
      <p style="margin:0 0 4px;"><strong style="color:#374151;">Payment ID:</strong> ${paymentId}</p>
      <p style="margin:0;"><strong style="color:#374151;">Order ID:</strong> ${orderId}</p>
    </div>

    <p style="color:#6b7280;font-size:13px;margin-top:4px;">
      For any billing queries, reply to this email or contact
      <a href="mailto:support@inquiai.in" style="color:#4f46e5;">support@inquiai.in</a>
    </p>
    ${ctaButton('Go to Dashboard →', `${dashboardUrl}/dashboard`)}
  `;

  await sendEmail({
    to: toEmail,
    subject: `🧾 Invoice #${invoiceNumber} — InquiAI ${plan} Plan`,
    html: baseTemplate('Invoice', body),
  });

  console.log(`[Email] Invoice sent to ${toEmail} (${invoiceNumber})`);
}
