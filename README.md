# AI Admission Assistant

An AI-powered college/university admission assistant that helps prospective students explore universities, check admission requirements, get personalized recommendations, and get answers to admission-related questions via an AI chatbot.

## Tech Stack

- **Frontend:** React + TypeScript, Tailwind CSS, React Router, Vite
- **Backend:** Node.js + Express (TypeScript)
- **AI:** OpenAI GPT-4o
- **Database:** SQLite (via `better-sqlite3`)

## Setup

### Prerequisites

- Node.js >= 18
- An [OpenAI API key](https://platform.openai.com/api-keys)

### Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment example file and add your OpenAI API key:
   ```bash
   cp .env.example server/.env
   # Edit server/.env and set OPENAI_API_KEY=<your key>
   ```

3. Seed the database with sample universities:
   ```bash
   npm run seed
   ```

4. Start the development servers (client + server):
   ```bash
   npm run dev
   ```

   - Client: http://localhost:5173
   - Server API: http://localhost:3001

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

## Project Structure

```
ai-admission-assistant/
├── client/          # Vite + React + TypeScript frontend
└── server/          # Express + TypeScript backend
```

