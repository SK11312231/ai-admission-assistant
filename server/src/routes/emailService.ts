import nodemailer from 'nodemailer';

// ── Transporter ──────────────────────────────────────────────────────────────

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('EMAIL_USER and EMAIL_PASS environment variables are required.');
    }
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // Gmail App Password (not your account password)
      },
    });
  }
  return transporter;
}

// ── Base HTML wrapper ────────────────────────────────────────────────────────

function baseTemplate(title: string, body: string): string {
  return `
<!DOCTYPE html>
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
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🎓 InquiAI</h1>
            <p style="margin:4px 0 0;color:#c7d2fe;font-size:13px;">AI Admission Assistant</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
              This is an automated notification from InquiAI. Login to your dashboard to manage leads.
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

function button(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin-top:20px;">${text}</a>`;
}

// ── 1. New Lead Notification ─────────────────────────────────────────────────

export async function sendNewLeadEmail(opts: {
  toEmail: string;
  instituteName: string;
  studentName: string | null;
  studentPhone: string;
  message: string;
  dashboardUrl?: string;
}): Promise<void> {
  const { toEmail, instituteName, studentName, studentPhone, message, dashboardUrl = 'https://ai-admission-assistant-production.up.railway.app' } = opts;
  const name = studentName ?? 'Unknown Student';

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">🔔 New Lead!</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">A new student has enquired via WhatsApp at <strong>${instituteName}</strong>.</p>
    ${infoBox(`
      <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#1f2937;">👤 ${name}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">📱 ${studentPhone}</p>
      <p style="margin:12px 0 4px;font-size:13px;color:#374151;font-style:italic;">"${message.slice(0, 200)}${message.length > 200 ? '…' : ''}"</p>
    `)}
    <p style="color:#6b7280;font-size:13px;">Log in to your dashboard to view the full conversation and manage this lead.</p>
    ${button('View Lead →', dashboardUrl)}
  `;

  await getTransporter().sendMail({
    from: `"InquiAI" <${process.env.EMAIL_USER}>`,
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
  const { toEmail, instituteName, leads, dashboardUrl = 'https://ai-admission-assistant-production.up.railway.app' } = opts;
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
    ${button('Open Dashboard →', dashboardUrl)}
  `;

  await getTransporter().sendMail({
    from: `"InquiAI" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `📅 ${leads.length} Follow-up${leads.length > 1 ? 's' : ''} Due Today — ${instituteName}`,
    html: baseTemplate('Follow-ups Due Today', body),
  });

  console.log(`[Email] Follow-up due email sent to ${toEmail} (${leads.length} leads)`);
}

// ── 3. 24h No-Reply Reminder ─────────────────────────────────────────────────

export async function sendNoReplyReminderEmail(opts: {
  toEmail: string;
  instituteName: string;
  leads: Array<{ student_name: string | null; student_phone: string; message: string; last_activity_at: string }>;
  dashboardUrl?: string;
}): Promise<void> {
  const { toEmail, instituteName, leads, dashboardUrl = 'https://ai-admission-assistant-production.up.railway.app' } = opts;
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
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;"><strong>${leads.length} student${leads.length > 1 ? 's' : ''}</strong> at <strong>${instituteName}</strong> haven't responded in over 24 hours. Consider sending a follow-up.</p>
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
    ${button('Send Follow-ups →', dashboardUrl)}
  `;

  await getTransporter().sendMail({
    from: `"InquiAI" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `💤 ${leads.length} Student${leads.length > 1 ? 's' : ''} Haven't Replied — ${instituteName}`,
    html: baseTemplate('No Reply Reminder', body),
  });

  console.log(`[Email] No-reply reminder sent to ${toEmail} (${leads.length} leads)`);
}

// ── 4. Weekly Summary ────────────────────────────────────────────────────────

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
  const { toEmail, instituteName, totalLeads, newThisWeek, contacted, converted, lost, conversionRate, dashboardUrl = 'https://ai-admission-assistant-production.up.railway.app' } = opts;

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
    ${button('View Full Dashboard →', dashboardUrl)}
  `;

  await getTransporter().sendMail({
    from: `"InquiAI" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `📊 Weekly Summary — ${instituteName} (${newThisWeek} new leads this week)`,
    html: baseTemplate('Weekly Summary', body),
  });

  console.log(`[Email] Weekly summary sent to ${toEmail}`);
}

// ── 5. Upgrade Plan Request (Admin Notification) ─────────────────────────────

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
    adminEmail,
    instituteName,
    instituteEmail,
    institutePhone,
    currentPlan,
    requestedPlan,
    requestId,
    dashboardUrl = 'https://ai-admission-assistant-production.up.railway.app',
  } = opts;

  const planLabel = requestedPlan.charAt(0).toUpperCase() + requestedPlan.slice(1);
  const currentLabel = currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1);

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">⬆️ Plan Upgrade Request</h2>
    <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">
      An institute has requested to upgrade their plan. Please review and action this request.
    </p>

    ${infoBox(`
      <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#1f2937;">🏫 ${instituteName}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">📧 ${instituteEmail}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">📱 ${institutePhone}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Request ID: <strong>#${requestId}</strong></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
      <p style="margin:0 0 4px;font-size:13px;color:#374151;">
        Current Plan: <span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-weight:600;">${currentLabel}</span>
      </p>
      <p style="margin:8px 0 0;font-size:14px;color:#374151;">
        Requested Plan: <span style="background:#ede9fe;color:#4f46e5;padding:2px 8px;border-radius:4px;font-weight:700;">${planLabel}</span>
      </p>
    `, '#f59e0b')}

    <p style="color:#6b7280;font-size:13px;margin-top:20px;">
      To approve this upgrade, update the institute's plan in your admin panel or run the following:
    </p>
    <div style="background:#1f2937;border-radius:8px;padding:14px 18px;margin:12px 0;">
      <code style="color:#a5f3fc;font-size:12px;font-family:monospace;">
        PATCH /api/institutes/&lt;id&gt;/plan  →  { "plan": "${requestedPlan}" }
      </code>
    </div>

    ${button('Open Dashboard →', dashboardUrl)}
  `;

  await getTransporter().sendMail({
    from: `"InquiAI" <${process.env.EMAIL_USER}>`,
    to: adminEmail,
    subject: `⬆️ Upgrade Request: ${instituteName} → ${planLabel} Plan`,
    html: baseTemplate('Plan Upgrade Request', body),
  });

  console.log(`[Email] Upgrade request email sent to admin (${adminEmail}) for institute: ${instituteName}`);
}
