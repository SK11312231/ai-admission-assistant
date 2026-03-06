import Database from 'better-sqlite3';
import path from 'path';

// Store the database file next to the server package
const DB_PATH = path.join(__dirname, '..', 'admission.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create universities table
db.exec(`
  CREATE TABLE IF NOT EXISTS universities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    ranking INTEGER NOT NULL,
    acceptance_rate REAL NOT NULL,
    programs TEXT NOT NULL,   -- JSON array of program names
    description TEXT NOT NULL
  );
`);

// Create messages table for chat history
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
