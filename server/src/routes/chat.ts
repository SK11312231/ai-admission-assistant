import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import pool from '../db';
import { getInstituteDetails } from './instituteEnrichment';

const router = Router();

interface MessageRow {
  role: 'user' | 'assistant';
  content: string;
}

// Lazy-initialise the OpenAI client
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

// Build system prompt using institute_details for a specific institute
// Falls back to generic counselor prompt if no instituteId provided
async function buildSystemPrompt(instituteId?: number): Promise<string> {
  if (instituteId) {
    // Fetch institute name
    const instResult = await pool.query(
      'SELECT name FROM institutes WHERE id = $1',
      [instituteId],
    );
    const instituteName: string = instResult.rows[0]?.name ?? 'this institute';

    // Fetch enriched profile
    const instituteData = await getInstituteDetails(instituteId);

    const contextSection = instituteData
      ? `You have the following detailed information about ${instituteName}:\n\n${instituteData}`
      : `You are representing ${instituteName}. Detailed profile information is not yet available. ` +
        `Answer general admission-related questions helpfully.`;

    return (
      `You are an AI admission assistant for ${instituteName}. ` +
      `Your job is to help prospective students with admission enquiries, course information, fees, eligibility, and placements.\n\n` +
      `${contextSection}\n\n` +
      `Guidelines:\n` +
      `- Be warm, encouraging, and professional.\n` +
      `- Answer based on the institute information provided above.\n` +
      `- If a question is outside the available information, say so honestly and suggest the student contact the institute directly.\n` +
      `- Keep responses concise and helpful (2-4 paragraphs max).\n` +
      `- Never make up fees, dates, or facts not present in the institute data.`
    );
  }

  // Generic fallback (no institute context — used by general chat widget)
  return (
    `You are an expert AI college admission counselor. Your goal is to help prospective students ` +
    `understand their options, navigate the admission process, and find universities that match their goals.\n\n` +
    `Guidelines:\n` +
    `- Be warm, encouraging, and professional.\n` +
    `- Provide helpful, accurate general admission guidance.\n` +
    `- If asked about a specific institute's fees or dates, advise the student to check directly with that institute.\n` +
    `- Keep responses concise but helpful (2-4 paragraphs max).`
  );
}

// POST /api/chat
router.post('/', async (req: Request, res: Response) => {
  const { message, sessionId, instituteId } = req.body as {
    message?: string;
    sessionId?: string;
    instituteId?: number;
  };

  if (!message || typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: 'message is required and must be a non-empty string.' });
    return;
  }
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required.' });
    return;
  }

  try {
    // Persist user message
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'user', message.trim()],
    );

    // Retrieve conversation history (last 20 messages)
    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20',
      [sessionId],
    );
    const history = historyResult.rows as MessageRow[];

    // Build institute-specific or generic prompt
    const systemPrompt = await buildSystemPrompt(instituteId);

    const client = getOpenAI();
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

    // Persist assistant reply
    await pool.query(
      'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, 'assistant', reply],
    );

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
    res.status(500).json({ error: msg });
  }
});

export default router;
