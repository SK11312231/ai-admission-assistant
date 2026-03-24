import { Pool } from 'pg';

// Railway provides DATABASE_URL automatically when a PostgreSQL service is linked.
// For local development, set it in server/.env.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? undefined
    : { rejectUnauthorized: false },
});

/**
 * Initialise the database schema.
 * Called once on server startup (from index.ts).
 * All CREATE TABLE / ALTER TABLE statements are idempotent (IF NOT EXISTS / IF NOT EXISTS).
 */
export async function initDB(): Promise<void> {
  console.log('🔧 Running initDB()...');

  // ── 1. institutes ──────────────────────────────────────────────────────────
  // NOTE: CHECK constraint updated from ('free','advance','pro')
  //       to ('starter','growth','pro') to match new pricing structure.
  //       Existing rows are migrated below via UPDATE.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS institutes (
      id                       SERIAL PRIMARY KEY,
      name                     TEXT NOT NULL,
      email                    TEXT NOT NULL UNIQUE,
      phone                    TEXT NOT NULL,
      whatsapp_number          TEXT NOT NULL UNIQUE,
      plan                     TEXT NOT NULL DEFAULT 'starter',
      password_hash            TEXT NOT NULL,
      created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe column additions (run on every startup — IF NOT EXISTS guards them)
  await pool.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS website TEXT`);
  await pool.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT`);
  await pool.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT`);
  await pool.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS whatsapp_waba_id TEXT`);
  await pool.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS whatsapp_connected BOOLEAN NOT NULL DEFAULT FALSE`);
  // is_paid: true = payment active (or Starter on trial), false = payment pending/expired
  await pool.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT TRUE`);
  // Backfill: existing institutes without a subscription row are treated as paid (grandfathered)
  // New Growth/Pro registrations will be inserted with is_paid = false

  // ── Migrate old plan slugs to new slugs ────────────────────────────────────
  // 'free'     → 'starter'  (old free-trial plan maps to starter)
  // 'advance'  → 'starter'  (typo variant in old CHECK constraint)
  // 'advanced' → 'growth'   (old "Advanced" paid plan maps to Growth)
  // 'pro'      → 'pro'      (unchanged)
  await pool.query(`UPDATE institutes SET plan = 'starter' WHERE plan IN ('free', 'advance')`);
  await pool.query(`UPDATE institutes SET plan = 'growth'  WHERE plan = 'advanced'`);

  // Drop the old CHECK constraint if it exists, then add the corrected one.
  // (Constraint name may vary — we catch the error and continue if it doesn't exist.)
  try {
    await pool.query(`ALTER TABLE institutes DROP CONSTRAINT IF EXISTS institutes_plan_check`);
  } catch { /* no-op */ }
  await pool.query(`
    ALTER TABLE institutes
      ADD CONSTRAINT institutes_plan_check
      CHECK (plan IN ('starter', 'growth', 'pro'))
  `).catch(() => { /* already exists with correct values — ignore */ });

  console.log('  ✅ institutes table ready');

  // ── 2. plans (dynamic pricing — editable by admin) ─────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id            SERIAL PRIMARY KEY,
      slug          VARCHAR(50)  NOT NULL UNIQUE,
      name          VARCHAR(100) NOT NULL,
      badge         VARCHAR(100),
      price_monthly INTEGER      NOT NULL,
      price_annual  INTEGER      NOT NULL,
      description   TEXT,
      features      JSONB        NOT NULL DEFAULT '[]',
      limits        JSONB        NOT NULL DEFAULT '{}',
      is_popular    BOOLEAN      NOT NULL DEFAULT FALSE,
      is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
      sort_order    INTEGER      NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // Seed / upsert the three plans (idempotent)
  await pool.query(`
    INSERT INTO plans (slug, name, badge, price_monthly, price_annual, description, features, limits, is_popular, sort_order)
    VALUES
      (
        'starter', 'Starter', '14-Day Free Trial', 2499, 24990,
        'Perfect for single-location coaching institutes starting with AI-powered admissions.',
        '[
          {"text": "1 WhatsApp number",             "core": true},
          {"text": "500 AI responses / month",       "core": true},
          {"text": "Up to 75 active leads tracked",  "core": true},
          {"text": "Auto-reply & lead capture",      "core": true},
          {"text": "Basic dashboard & analytics",    "core": true},
          {"text": "Email support",                  "core": true}
        ]'::jsonb,
        '{"whatsapp_numbers": 1, "ai_responses": 500, "active_leads": 75}'::jsonb,
        FALSE, 1
      ),
      (
        'growth', 'Growth', 'Most Popular', 3999, 39990,
        'For growing institutes that are converting well and need more capacity.',
        '[
          {"text": "Up to 2 WhatsApp numbers",                        "core": true},
          {"text": "2,000 AI responses / month",                      "core": true},
          {"text": "Unlimited active leads",                          "core": true},
          {"text": "AI Training (upload chat history)",               "core": false},
          {"text": "Advanced analytics & conversion reports",         "core": false},
          {"text": "Follow-up sequences (auto 2nd & 3rd message)",    "core": false},
          {"text": "Priority email support",                          "core": true}
        ]'::jsonb,
        '{"whatsapp_numbers": 2, "ai_responses": 2000, "active_leads": -1}'::jsonb,
        TRUE, 2
      ),
      (
        'pro', 'Pro', 'Full Power', 8999, 89990,
        'For large institutes and multi-branch chains that need unlimited scale.',
        '[
          {"text": "Unlimited WhatsApp numbers",                 "core": true},
          {"text": "Unlimited AI responses",                     "core": true},
          {"text": "Multi-branch management (single dashboard)", "core": false},
          {"text": "Custom AI persona & tone training",          "core": false},
          {"text": "Bulk broadcast messaging",                   "core": false},
          {"text": "Dedicated support + onboarding call",        "core": true}
        ]'::jsonb,
        '{"whatsapp_numbers": -1, "ai_responses": -1, "active_leads": -1}'::jsonb,
        FALSE, 3
      )
    ON CONFLICT (slug) DO UPDATE SET
      name          = EXCLUDED.name,
      badge         = EXCLUDED.badge,
      price_monthly = EXCLUDED.price_monthly,
      price_annual  = EXCLUDED.price_annual,
      description   = EXCLUDED.description,
      features      = EXCLUDED.features,
      limits        = EXCLUDED.limits,
      is_popular    = EXCLUDED.is_popular,
      sort_order    = EXCLUDED.sort_order,
      updated_at    = NOW()
  `);
  console.log('  ✅ plans table ready');

  // ── 3. leads ───────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id                SERIAL PRIMARY KEY,
      institute_id      INTEGER NOT NULL REFERENCES institutes(id),
      student_name      TEXT,
      student_phone     TEXT NOT NULL,
      message           TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'new'
                          CHECK(status IN ('new', 'contacted', 'converted', 'lost')),
      notes             TEXT,
      follow_up_date    TIMESTAMPTZ,
      last_activity_at  TIMESTAMPTZ DEFAULT NOW(),
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Safe column additions for existing installs
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW()`);
  console.log('  ✅ leads table ready');

  // ── 4. blocked_numbers ────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_numbers (
      id            SERIAL PRIMARY KEY,
      institute_id  INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
      phone         TEXT NOT NULL,
      reason        TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(institute_id, phone)
    )
  `);
  console.log('  ✅ blocked_numbers table ready');

  // ── 5. upgrade_requests ───────────────────────────────────────────────────
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
  console.log('  ✅ upgrade_requests table ready');

  // ── 6. password_reset_tokens ──────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id            SERIAL PRIMARY KEY,
      institute_id  INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
      token         TEXT NOT NULL UNIQUE,
      expires_at    TIMESTAMPTZ NOT NULL,
      used          BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✅ password_reset_tokens table ready');

  // ── 7. institute_details ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS institute_details (
      id            SERIAL PRIMARY KEY,
      institute_id  INTEGER NOT NULL UNIQUE REFERENCES institutes(id) ON DELETE CASCADE,
      institute_data TEXT NOT NULL,
      scraped_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✅ institute_details table ready');

  // ── 8. AI Training tables ─────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_examples (
      id              SERIAL PRIMARY KEY,
      institute_id    INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
      student_message TEXT NOT NULL,
      owner_reply     TEXT NOT NULL,
      category        TEXT DEFAULT 'general',
      is_approved     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_examples_institute
      ON chat_examples (institute_id, is_approved)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS institute_personality (
      institute_id   INTEGER PRIMARY KEY REFERENCES institutes(id) ON DELETE CASCADE,
      profile        TEXT NOT NULL,
      language_style TEXT DEFAULT 'english',
      example_count  INTEGER DEFAULT 0,
      generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reply_feedback (
      id              SERIAL PRIMARY KEY,
      institute_id    INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
      session_id      TEXT NOT NULL,
      student_message TEXT NOT NULL,
      ai_reply        TEXT NOT NULL,
      feedback        TEXT CHECK (feedback IN ('good', 'bad')),
      corrected_reply TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reply_feedback_institute
      ON reply_feedback (institute_id)
  `);
  console.log('  ✅ AI Training tables ready');

  // ── 9. universities ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS universities (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      location        TEXT NOT NULL,
      ranking         INTEGER NOT NULL,
      acceptance_rate DOUBLE PRECISION NOT NULL,
      programs        TEXT NOT NULL,
      description     TEXT NOT NULL
    );
  `);
  console.log('  ✅ universities table ready');

  // ── 10. messages ──────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id         SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content    TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('  ✅ messages table ready');

  // ── 11. admins ────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('  ✅ admins table ready');

  // ── 12. payments ──────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id                   SERIAL PRIMARY KEY,
      institute_id         INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
      razorpay_order_id    TEXT    NOT NULL UNIQUE,
      razorpay_payment_id  TEXT,
      plan                 TEXT    NOT NULL,
      billing_cycle        TEXT    NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
      amount_inr           INTEGER NOT NULL,
      status               TEXT    NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'success', 'failed')),
      paid_at              TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_institute
      ON payments (institute_id, status)
  `);
  console.log('  ✅ payments table ready');

  // ── 13. subscriptions ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                   SERIAL PRIMARY KEY,
      institute_id         INTEGER NOT NULL UNIQUE REFERENCES institutes(id) ON DELETE CASCADE,
      plan                 TEXT    NOT NULL,
      billing_cycle        TEXT    NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
      amount_inr           INTEGER NOT NULL,
      started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at           TIMESTAMPTZ NOT NULL,
      razorpay_order_id    TEXT,
      razorpay_payment_id  TEXT,
      status               TEXT    NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'expired', 'cancelled')),
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✅ subscriptions table ready');

  console.log('✅ initDB() complete — all tables ready.');
}

export default pool;