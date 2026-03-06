import { Pool } from 'pg';

// Railway provides DATABASE_URL automatically when a PostgreSQL service is linked.
// For local development, set it in server/.env.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

/**
 * Initialise the database schema.
 * Called once on server startup (from index.ts).
 */
export async function initDB(): Promise<void> {
  // Create institutes table — stores registered institutes / coaching centers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS institutes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      whatsapp_number TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL CHECK(plan IN ('free', 'advance', 'pro')),
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create leads table — stores student inquiries received via WhatsApp
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      institute_id INTEGER NOT NULL REFERENCES institutes(id),
      student_name TEXT,
      student_phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'contacted', 'converted', 'lost')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create universities table — stores university data for AI counselor
  await pool.query(`
    CREATE TABLE IF NOT EXISTS universities (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      ranking INTEGER NOT NULL,
      acceptance_rate DOUBLE PRECISION NOT NULL,
      programs TEXT NOT NULL,
      description TEXT NOT NULL
    );
  `);

  // Create messages table — stores chat conversation history per session
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export default pool;
