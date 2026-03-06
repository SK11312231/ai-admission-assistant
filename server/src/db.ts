import Database from 'better-sqlite3';
import path from 'path';

// Store the database file next to the server package
const DB_PATH = path.join(__dirname, '..', 'admission.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create institutes table — stores registered institutes / coaching centers
db.exec(`
  CREATE TABLE IF NOT EXISTS institutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL CHECK(plan IN ('free', 'advance', 'pro')),
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create leads table — stores student inquiries received via WhatsApp
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    institute_id INTEGER NOT NULL,
    student_name TEXT,
    student_phone TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'contacted', 'converted', 'lost')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (institute_id) REFERENCES institutes(id)
  );
`);

// Create universities table — stores university data for AI counselor
db.exec(`
  CREATE TABLE IF NOT EXISTS universities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    ranking INTEGER NOT NULL,
    acceptance_rate REAL NOT NULL,
    programs TEXT NOT NULL,
    description TEXT NOT NULL
  );
`);

// Create messages table — stores chat conversation history per session
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;
