# Lead Capture Platform

A platform that helps institutes, coaching centers, and universities capture student leads efficiently via WhatsApp. When a student sends a WhatsApp inquiry to a registered institute, a lead is automatically created and an instant auto-reply is sent back.

## Tech Stack

- **Frontend:** React + TypeScript, Tailwind CSS, React Router, Vite
- **Backend:** Node.js + Express (TypeScript)
- **Database:** SQLite (via `better-sqlite3`)
- **WhatsApp Integration:** WhatsApp Business Cloud API (Meta)

## Data Storage

All application data is stored in a local **SQLite** database file at `server/admission.db` using the [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) driver. The database runs in [WAL mode](https://www.sqlite.org/wal.html) for better concurrent read performance. Tables are created on first server start if they don't already exist (via `server/src/db.ts`), so no manual migration step is needed.

### Database Tables

| Table | Purpose |
|-------|---------|
| `institutes` | Registered institutes / coaching centers (name, email, phone, WhatsApp number, plan, hashed password) |
| `leads` | Student inquiries captured via WhatsApp (linked to an institute, includes student phone, message, and status) |
| `universities` | University catalog used by the AI admission counselor (name, location, ranking, acceptance rate, programs, description) |
| `messages` | Chat conversation history between students and the AI counselor (session-based, stores role and content) |

### Key Details

- **File location:** `server/admission.db` (auto-created on first server start, git-ignored)
- **Engine:** SQLite 3 via `better-sqlite3` (embedded, no external database server required)
- **Initialization:** All tables use `CREATE TABLE IF NOT EXISTS`, making startup idempotent
- **Seeding:** The `universities` table is populated with sample data on first run via `server/src/seed.ts`

## Quickstart

### Prerequisites

- Node.js >= 18
- (Optional) A [Meta WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api) token for WhatsApp integration

### Three steps to run

```bash
# 1. Install all dependencies
npm install

# 2. Create server/.env and configure environment variables
npm run setup

# 3. Start both servers (client + API)
npm run dev
```

| Service | URL |
|---------|-----|
| Client (React) | http://localhost:5173 |
| API (Express) | http://localhost:3001 |

### WhatsApp Integration Setup

To enable automatic lead capture via WhatsApp, add the following to `server/.env`:

```env
WHATSAPP_VERIFY_TOKEN=your_custom_verification_token
WHATSAPP_API_TOKEN=your_meta_access_token
```

Then configure a webhook in your Meta Business App pointing to:
- **Verify (GET):** `https://your-domain.com/api/webhook/whatsapp`
- **Messages (POST):** `https://your-domain.com/api/webhook/whatsapp`

## Usage

- **Home (`/`)** — Platform overview, features, and pricing plans.
- **Register (`/register`)** — Register your institute with name, email, phone, WhatsApp number, and plan.
- **Login (`/login`)** — Login to access your dashboard.
- **Dashboard (`/dashboard`)** — View and manage all student leads with status tracking and filters.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/institutes/register` | Register a new institute |
| POST | `/api/institutes/login` | Login as an institute |
| GET | `/api/leads/:instituteId` | Get all leads for an institute |
| PATCH | `/api/leads/:leadId/status` | Update a lead's status |
| GET | `/api/webhook/whatsapp` | WhatsApp webhook verification |
| POST | `/api/webhook/whatsapp` | Receive incoming WhatsApp messages |

### POST `/api/institutes/register` body
```json
{
  "name": "ABC Coaching Center",
  "email": "contact@abc.com",
  "phone": "+919876543210",
  "whatsapp_number": "+919876543210",
  "plan": "free",
  "password": "securepassword"
}
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | First-time setup — creates `server/.env` |
| `npm run dev` | Start client + server in watch mode |
| `npm run build` | Production build (server + client) |

## Project Structure

```
ai-admission-assistant/
├── scripts/
│   └── setup.mjs           # First-time setup helper
├── client/                  # Vite + React + TypeScript frontend
│   └── src/
│       ├── components/      # Navbar
│       └── pages/           # Home, Register, Login, Dashboard
└── server/                  # Express + TypeScript backend
    └── src/
        ├── db.ts            # SQLite database setup (all tables)
        ├── seed.ts          # University sample data seeder
        ├── index.ts         # Server entry point
        └── routes/          # institutes, leads, universities, chat, webhook
```


