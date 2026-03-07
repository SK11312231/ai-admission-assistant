import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import pool from '../db';

const router = Router();

interface University {
  id: number;
  name: string;
  location: string;
  ranking: number;
  acceptance_rate: number;
  programs: string;
  description: string;
}

interface MessageRow {
  role: 'user' | 'assistant';
  content: string;
}

// Lazy-initialise the OpenAI client so the server still boots without a key
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not set. Please add it to your .env file.');
    }
    openai = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return openai;
}

// Build the system prompt with current universities data
async function buildSystemPrompt(): Promise<string> {
  const result = await pool.query('SELECT * FROM universities ORDER BY ranking ASC');
  const universities = result.rows as University[];

  const uniList = universities
    .map((u) => {
      const programs = JSON.parse(u.programs) as string[];
      return (
        `- **${u.name}** (Ranking: #${u.ranking}, Location: ${u.location}, ` +
        `Acceptance Rate: ${u.acceptance_rate}%)\n` +
        `  Programs: ${programs.join(', ')}\n` +
        `  ${u.description}`
      );
    })
    .join('\n\n');

  return (
    `You are an expert AI college admission counselor. Your goal is to help prospective students ` +
    `understand their options, navigate the admission process, and find universities that match their goals.\n\n` +
    `You have access to the following university database:\n\n` +
    `${uniList}\n\n` +
    `Guidelines:\n` +
    `- Be warm, encouraging, and professional.\n` +
    `- Provide specific, accurate information based on the data above.\n` +
    `- When recommending universities, consider the student's interests and goals.\n` +
    `- If asked about something outside the provided data, be honest about limitations.\n` +
    `- Keep responses concise but helpful (2–4 paragraphs max).`
  );
}

// POST /api/chat — send a message and receive an AI reply
router.post('/', async (req: Request, res: Response) => {
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };

  if (!message || typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: 'message is required and must be a non-empty string.' });
    return;
  }

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required.' });
    return;
  }

  try {
    // Persist the user message
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', message.trim()],
    );

    // Retrieve conversation history for this session (last 20 messages for context)
    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
      [sessionId],
    );
    const history = historyResult.rows as MessageRow[];

    // Call OpenAI
    const client = getOpenAI();
    const systemPrompt = await buildSystemPrompt();
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const reply = completion.choices[0]?.message?.content ?? 'Sorry, I could not generate a response.';

    // Persist the assistant reply
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'assistant', reply],
    );

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred.';
    res.status(500).json({ error: message });
  }
});

export default router;
