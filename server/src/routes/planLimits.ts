// routes/planLimits.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for all plan limits.
// Used by: whatsappManager, webhook, leads, analytics, chatTraining
//
// Limits:
//   ai_responses  : monthly AI replies cap (-1 = unlimited)
//   active_leads  : max simultaneous non-lost leads (-1 = unlimited)
//   whatsapp_numbers : max connected WhatsApp sessions (-1 = unlimited)
// ─────────────────────────────────────────────────────────────────────────────

import pool from '../db';

export interface PlanLimits {
  ai_responses:      number;  // per month
  active_leads:      number;  // simultaneous
  whatsapp_numbers:  number;  // connected sessions
  analytics:         boolean; // advanced analytics access
  ai_training:       boolean; // AI Training feature access
  follow_up_sequences: boolean; // auto follow-up sequences
  bulk_broadcast:    boolean; // bulk broadcast messaging
  multi_branch:      boolean; // multi-branch management
}

const LIMITS: Record<string, PlanLimits> = {
  starter: {
    ai_responses:        500,
    active_leads:         75,
    whatsapp_numbers:      1,
    analytics:         false,
    ai_training:       false,
    follow_up_sequences: false,
    bulk_broadcast:    false,
    multi_branch:      false,
  },
  growth: {
    ai_responses:       2000,
    active_leads:         -1,
    whatsapp_numbers:      2,
    analytics:          true,
    ai_training:        true,
    follow_up_sequences: true,  // ✅ Growth feature — now implemented
    bulk_broadcast:    false,   // Phase 3
    multi_branch:      false,   // Phase 3
  },
  pro: {
    ai_responses:         -1,
    active_leads:         -1,
    whatsapp_numbers:     -1,
    analytics:          true,
    ai_training:        true,
    follow_up_sequences: true,  // Phase 2
    bulk_broadcast:     true,   // Phase 3
    multi_branch:       true,   // Phase 3
  },
};

export function getLimits(plan: string): PlanLimits {
  return LIMITS[plan.toLowerCase()] ?? LIMITS.starter;
}

// ── Current month key ─────────────────────────────────────────────────────────
export function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── Check AI response limit ───────────────────────────────────────────────────
// Returns { allowed: true } or { allowed: false, used, limit }
export async function checkAndIncrementAIResponse(
  instituteId: number,
  plan: string,
): Promise<{ allowed: boolean; used?: number; limit?: number }> {
  const limits = getLimits(plan);

  // Unlimited plan — just increment and allow
  if (limits.ai_responses === -1) {
    await incrementAIResponse(instituteId);
    return { allowed: true };
  }

  const ym = currentYearMonth();

  // Get current count
  const result = await pool.query(
    `SELECT response_count FROM ai_response_usage
     WHERE institute_id = $1 AND year_month = $2`,
    [instituteId, ym],
  );

  const used = Number(result.rows[0]?.response_count ?? 0);

  if (used >= limits.ai_responses) {
    console.log(`[Limits] Institute ${instituteId} hit AI response cap: ${used}/${limits.ai_responses}`);
    return { allowed: false, used, limit: limits.ai_responses };
  }

  // Increment count
  await incrementAIResponse(instituteId);
  return { allowed: true };
}

async function incrementAIResponse(instituteId: number): Promise<void> {
  const ym = currentYearMonth();
  await pool.query(
    `INSERT INTO ai_response_usage (institute_id, year_month, response_count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (institute_id, year_month)
     DO UPDATE SET response_count = ai_response_usage.response_count + 1, updated_at = NOW()`,
    [instituteId, ym],
  );
}

// ── Check active leads limit ──────────────────────────────────────────────────
export async function checkActiveleadsLimit(
  instituteId: number,
  plan: string,
): Promise<{ allowed: boolean; used?: number; limit?: number }> {
  const limits = getLimits(plan);
  if (limits.active_leads === -1) return { allowed: true };

  const result = await pool.query(
    `SELECT COUNT(*) AS count FROM leads
     WHERE institute_id = $1
     AND status NOT IN ('lost', 'converted')`,
    [instituteId],
  );

  const used = Number(result.rows[0]?.count ?? 0);

  if (used >= limits.active_leads) {
    console.log(`[Limits] Institute ${instituteId} hit active leads cap: ${used}/${limits.active_leads}`);
    return { allowed: false, used, limit: limits.active_leads };
  }

  return { allowed: true };
}

// ── Check WhatsApp session limit ──────────────────────────────────────────────
export async function checkWhatsAppSessionLimit(
  instituteId: number,
  plan: string,
  currentSessionCount: number,
): Promise<{ allowed: boolean; limit?: number }> {
  const limits = getLimits(plan);
  if (limits.whatsapp_numbers === -1) return { allowed: true };

  if (currentSessionCount >= limits.whatsapp_numbers) {
    console.log(`[Limits] Institute ${instituteId} hit WhatsApp session cap: ${currentSessionCount}/${limits.whatsapp_numbers}`);
    return { allowed: false, limit: limits.whatsapp_numbers };
  }

  return { allowed: true };
}

// ── Fetch institute plan (used by enforcement points) ─────────────────────────
export async function getInstitutePlan(instituteId: number): Promise<string> {
  try {
    const result = await pool.query(
      'SELECT plan, is_paid FROM institutes WHERE id = $1',
      [instituteId],
    );
    const row = result.rows[0] as { plan: string; is_paid: boolean } | undefined;
    // If not paid, treat as starter for limit purposes
    if (!row) return 'starter';
    if (!row.is_paid && row.plan !== 'starter') return 'starter';
    return row.plan;
  } catch {
    return 'starter'; // fail safe
  }
}

// ── Get current AI usage for dashboard display ────────────────────────────────
export async function getAIUsageThisMonth(
  instituteId: number,
): Promise<{ used: number; limit: number; plan: string }> {
  const plan = await getInstitutePlan(instituteId);
  const limits = getLimits(plan);
  const ym = currentYearMonth();

  const result = await pool.query(
    `SELECT response_count FROM ai_response_usage
     WHERE institute_id = $1 AND year_month = $2`,
    [instituteId, ym],
  );

  return {
    used:  Number(result.rows[0]?.response_count ?? 0),
    limit: limits.ai_responses,
    plan,
  };
}