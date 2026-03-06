# AI Admission Assistant

An AI-powered college/university admission assistant that helps prospective students explore universities, check admission requirements, get personalized recommendations, and get answers to admission-related questions via an AI chatbot.

## Tech Stack

- **Frontend:** React + TypeScript, Tailwind CSS, React Router, Vite
- **Backend:** Node.js + Express (TypeScript)
- **AI:** OpenAI GPT-4o
- **Database:** SQLite (via `better-sqlite3`)

## Quickstart

### Prerequisites

- Node.js >= 18
- An [OpenAI API key](https://platform.openai.com/api-keys)

### Three steps to run

```bash
# 1. Install all dependencies
npm install

# 2. Create server/.env and follow the prompt to add your OpenAI API key
npm run setup

# 3. Start both servers (client + API)
npm run dev
```

| Service | URL |
|---------|-----|
| Client (React) | http://localhost:5173 |
| API (Express) | http://localhost:3001 |

> **Note:** The database is seeded automatically when the server starts for the first time.
> You can also seed manually with `npm run seed`.

## Usage

- **Home (`/`)** — Overview and quick-start CTA.
- **Chat (`/chat`)** — Ask the AI admission counselor anything about universities, requirements, and applications.
- **Universities (`/universities`)** — Browse the seeded university database with rankings and acceptance rates.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/universities` | List all universities |
| GET | `/api/universities/:id` | Get a single university |
| POST | `/api/chat` | Send a message to the AI counselor |

### POST `/api/chat` body
```json
{ "message": "Which universities have the best CS programs?", "sessionId": "abc123" }
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | First-time setup — creates `server/.env` |
| `npm run dev` | Start client + server in watch mode |
| `npm run build` | Production build (server + client) |
| `npm run seed` | Manually seed the database |

## Project Structure

```
ai-admission-assistant/
├── scripts/
│   └── setup.mjs        # First-time setup helper
├── client/              # Vite + React + TypeScript frontend
│   └── src/
│       ├── components/  # Navbar, ChatWindow, MessageBubble, UniversityCard
│       └── pages/       # Home, Chat, Universities
└── server/              # Express + TypeScript backend
    └── src/
        ├── db.ts         # SQLite database setup
        ├── seed.ts       # Sample data seeder
        ├── index.ts      # Server entry point
        └── routes/       # chat.ts, universities.ts
```


