import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import pool from '../db';

const router = Router();

// ── Lazy Groq client ──────────────────────────────────────────────────────────

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set.');
    openai = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return openai;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatPair {
  studentMessage: string;
  ownerReply: string;
}

// ── WhatsApp .txt export parser ───────────────────────────────────────────────
//
// Handles the standard WhatsApp "Export Chat" .txt format:
//   15/03/2025, 9:18 PM - Saurabh: Hi I want info about your course
//   15/03/2025, 9:19 PM - Institute: Sure! Which course are you interested in?
//
// Also handles:
//   [15/03/2025, 9:18:22 PM] Saurabh: message
//
// Multi-line messages are concatenated onto the previous message.

function parseWhatsAppExport(text: string): ChatPair[] {
  const lines = text.split('\n');

  // Regex for standard format: date, time - name: message
  const standardPattern = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[APap][Mm])\s*[-–]\s*([^:]+):\s*(.+)$/;
  // Regex for bracket format: [date, time] name: message
  const bracketPattern = /^\[(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[APap][Mm])\]\s*([^:]+):\s*(.+)$/;

  interface RawMessage {
    sender: string;
    content: string;
  }

  const messages: RawMessage[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip system messages (WhatsApp notifications)
    if (
      trimmed.includes('Messages and calls are end-to-end encrypted') ||
      trimmed.includes('created group') ||
      trimmed.includes('added') ||
      trimmed.includes('left') ||
      trimmed.match(/^\d{1,2}\/\d{1,2}\/\d{2,4},\s+\d{1,2}:\d{2}\s*[APap][Mm]\s*[-–]\s*$/)
    ) continue;

    const match = trimmed.match(standardPattern) || trimmed.match(bracketPattern);
    if (match) {
      const sender = match[3].trim();
      const content = match[4].trim();
      // Skip media omitted messages
      if (content === '<Media omitted>' || content === 'image omitted' || content === 'video omitted') continue;
      messages.push({ sender, content });
    } else if (messages.length > 0) {
      // Continuation of previous message (multi-line)
      messages[messages.length - 1].content += ' ' + trimmed;
    }
  }

  if (messages.length === 0) return [];

  // Identify the "owner" — the sender who appears to be the institute
  // Strategy: The owner is the sender who appears SECOND in the conversation
  // (students usually initiate). If ambiguous, the less frequent sender is the student.
  const senderCounts: Record<string, number> = {};
  for (const m of messages) {
    senderCounts[m.sender] = (senderCounts[m.sender] ?? 0) + 1;
  }

  const senders = Object.keys(senderCounts);
  if (senders.length < 2) return []; // can't identify pairs with only one sender

  // The owner is typically the sender with longer average messages (more informative)
  let ownerSender = senders[0];
  let maxAvgLength = 0;
  for (const sender of senders) {
    const msgs = messages.filter(m => m.sender === sender);
    const avgLength = msgs.reduce((sum, m) => sum + m.content.length, 0) / msgs.length;
    if (avgLength > maxAvgLength) {
      maxAvgLength = avgLength;
      ownerSender = sender;
    }
  }

  // Extract conversation pairs: student message followed by owner reply
  const pairs: ChatPair[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const current = messages[i];
    const next = messages[i + 1];
    if (current.sender !== ownerSender && next.sender === ownerSender) {
      // Filter out very short or meaningless pairs
      if (current.content.length < 3 || next.content.length < 10) continue;
      pairs.push({
        studentMessage: current.content.trim(),
        ownerReply: next.content.trim(),
      });
    }
  }

  return pairs;
}

// ── Categorise a conversation pair ───────────────────────────────────────────
// Simple keyword-based categorisation — no Groq call needed, runs locally.

function categorisePair(studentMessage: string, ownerReply: string): string {
  const combined = (studentMessage + ' ' + ownerReply).toLowerCase();

  if (/fee|fees|cost|price|expensive|afford|payment|emi|scholarship|discount/.test(combined))
    return 'fee_objection';
  if (/book|demo|visit|schedule|appointment|call|contact|meet/.test(combined))
    return 'booking';
  if (/placement|job|salary|package|hired|company|campus/.test(combined))
    return 'placement';
  if (/duration|months|weeks|batch|timing|weekend|weekday|online|offline/.test(combined))
    return 'course_details';
  if (/eligible|eligibility|qualification|degree|graduate|experience|fresher/.test(combined))
    return 'eligibility';
  if (/think|time|later|decide|confirm|sure|not sure|wait/.test(combined))
    return 'hesitation';
  if (/hi|hello|hlo|hey|namaste/.test(studentMessage.toLowerCase()))
    return 'greeting';

  return 'general';
}

// ── POST /api/training/:instituteId/parse ─────────────────────────────────────
// Accepts a WhatsApp .txt export as raw text in the request body.
// Parses it into conversation pairs and stores them in chat_examples.

router.post('/:instituteId/parse', async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  const { chatText } = req.body as { chatText?: string };

  if (!chatText || typeof chatText !== 'string' || chatText.trim().length < 50) {
    res.status(400).json({ error: 'chatText is required and must be a valid WhatsApp export.' });
    return;
  }

  try {
    const pairs = parseWhatsAppExport(chatText);

    if (pairs.length === 0) {
      res.status(422).json({
        error: 'Could not extract any conversation pairs from this text. Make sure you exported the chat correctly from WhatsApp (Export Chat → Without Media).',
      });
      return;
    }

    // Store all extracted pairs
    let inserted = 0;
    for (const pair of pairs) {
      const category = categorisePair(pair.studentMessage, pair.ownerReply);
      await pool.query(
        `INSERT INTO chat_examples (institute_id, student_message, owner_reply, category)
         VALUES ($1, $2, $3, $4)`,
        [Number(instituteId), pair.studentMessage, pair.ownerReply, category],
      );
      inserted++;
    }

    console.log(`[Training] Inserted ${inserted} examples for institute ${instituteId}`);
    res.json({ success: true, extracted: pairs.length, stored: inserted });
  } catch (err) {
    console.error('[Training] Parse error:', err);
    res.status(500).json({ error: 'Failed to parse chat export.' });
  }
});

// ── POST /api/training/:instituteId/generate-profile ─────────────────────────
// Runs a single Groq call over all stored examples to generate a personality
// profile for the institute owner. Stored in institute_personality table.

router.post('/:instituteId/generate-profile', async (req: Request, res: Response) => {
  const { instituteId } = req.params;

  try {
    // Fetch up to 60 examples (enough for a solid profile, not too many tokens)
    const result = await pool.query(
      `SELECT student_message, owner_reply, category
       FROM chat_examples
       WHERE institute_id = $1 AND is_approved = TRUE
       ORDER BY created_at DESC LIMIT 60`,
      [Number(instituteId)],
    );

    if (result.rows.length < 5) {
      res.status(400).json({
        error: 'Need at least 5 approved conversation examples to generate a profile. Upload more chats first.',
      });
      return;
    }

    // Build a sample transcript for analysis
    const sampleTranscript = result.rows
      .slice(0, 30) // use 30 examples for analysis
      .map((r: { student_message: string; owner_reply: string }, i: number) =>
        `[${i + 1}]\nStudent: ${r.student_message}\nOwner: ${r.owner_reply}`,
      )
      .join('\n\n');

    // Count category distribution
    const categoryCounts: Record<string, number> = {};
    for (const row of result.rows as Array<{ category: string }>) {
      categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
    }
    const topCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `${cat}: ${count}`)
      .join(', ');

    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content:
          `You are analysing real WhatsApp conversations between an educational institute owner/counselor and prospective students.\n\n` +
          `Based on these ${result.rows.length} conversation examples, write a detailed personality and communication profile.\n\n` +
          `Sample conversations:\n\n${sampleTranscript}\n\n` +
          `Topic distribution: ${topCategories}\n\n` +
          `Write a profile covering:\n` +
          `1. TONE & STYLE: How does the owner communicate? (formal/informal, warm/professional, concise/detailed)\n` +
          `2. LANGUAGE: What language mix do they use? (English/Hindi/Hinglish, any specific phrases they repeat)\n` +
          `3. FEE HANDLING: How do they handle fee-related questions or objections? What specific techniques?\n` +
          `4. HESITATION HANDLING: How do they handle "I'll think about it" or "not sure"?\n` +
          `5. BOOKING APPROACH: How do they move a conversation toward a demo or visit?\n` +
          `6. PERSUASION STYLE: What proof points, guarantees, or reassurances do they use?\n` +
          `7. CLOSING STYLE: How do they typically end a conversation?\n` +
          `8. COMMON PHRASES: List 5-8 phrases or expressions this person frequently uses.\n\n` +
          `Be specific and concrete. Quote actual phrases from the examples where relevant.\n` +
          `This profile will be used to train an AI to respond in the same style.`,
      }],
      temperature: 0.3,
      max_tokens: 1200,
    });

    const profile = completion.choices[0]?.message?.content?.trim() ?? '';

    if (!profile) {
      res.status(500).json({ error: 'Failed to generate profile. Try again.' });
      return;
    }

    // Detect language style from examples
    const allText = result.rows
      .map((r: { owner_reply: string }) => r.owner_reply)
      .join(' ');
    const hindiCharPattern = /[\u0900-\u097F]/;
    const hasHindi = hindiCharPattern.test(allText);
    const hasEnglish = /[a-zA-Z]{3,}/.test(allText);
    const languageStyle = hasHindi && hasEnglish ? 'hinglish' : hasHindi ? 'hindi' : 'english';

    // Upsert into institute_personality
    await pool.query(
      `INSERT INTO institute_personality (institute_id, profile, language_style, example_count, generated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (institute_id)
       DO UPDATE SET profile = EXCLUDED.profile,
                     language_style = EXCLUDED.language_style,
                     example_count = EXCLUDED.example_count,
                     generated_at = NOW()`,
      [Number(instituteId), profile, languageStyle, result.rows.length],
    );

    console.log(`[Training] Profile generated for institute ${instituteId} (${languageStyle}, ${result.rows.length} examples)`);
    res.json({ success: true, profile, languageStyle, examplesUsed: result.rows.length });
  } catch (err) {
    console.error('[Training] Generate profile error:', err);
    res.status(500).json({ error: 'Failed to generate profile.' });
  }
});

// ── GET /api/training/:instituteId/status ────────────────────────────────────
// Returns training status: example count, profile existence, category breakdown.

router.get('/:instituteId/status', async (req: Request, res: Response) => {
  const { instituteId } = req.params;

  try {
    const [examplesResult, profileResult] = await Promise.all([
      pool.query(
        `SELECT category, COUNT(*) as count
         FROM chat_examples
         WHERE institute_id = $1 AND is_approved = TRUE
         GROUP BY category`,
        [Number(instituteId)],
      ),
      pool.query(
        `SELECT profile, language_style, example_count, generated_at
         FROM institute_personality
         WHERE institute_id = $1`,
        [Number(instituteId)],
      ),
    ]);

    const totalExamples = examplesResult.rows.reduce(
      (sum: number, r: { count: string }) => sum + Number(r.count), 0,
    );
    const categoryBreakdown = Object.fromEntries(
      examplesResult.rows.map((r: { category: string; count: string }) => [r.category, Number(r.count)]),
    );

    const personality = profileResult.rows[0] ?? null;

    res.json({
      totalExamples,
      categoryBreakdown,
      hasProfile: !!personality,
      profile: personality?.profile ?? null,
      languageStyle: personality?.language_style ?? null,
      profileGeneratedAt: personality?.generated_at ?? null,
      readyToUse: totalExamples >= 5 && !!personality,
    });
  } catch (err) {
    console.error('[Training] Status error:', err);
    res.status(500).json({ error: 'Failed to fetch training status.' });
  }
});

// ── GET /api/training/:instituteId/examples ───────────────────────────────────
// Returns paginated list of stored chat examples.

router.get('/:instituteId/examples', async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = 20;
  const offset = (page - 1) * limit;
  const category = req.query.category as string | undefined;

  try {
    const conditions = [`institute_id = $1`];
    const params: unknown[] = [Number(instituteId)];

    if (category && category !== 'all') {
      conditions.push(`category = $${params.length + 1}`);
      params.push(category);
    }

    const where = conditions.join(' AND ');

    const [rows, countResult] = await Promise.all([
      pool.query(
        `SELECT id, student_message, owner_reply, category, is_approved, created_at
         FROM chat_examples WHERE ${where}
         ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*) as total FROM chat_examples WHERE ${where}`, params),
    ]);

    res.json({
      examples: rows.rows,
      total: Number(countResult.rows[0].total),
      page,
      totalPages: Math.ceil(Number(countResult.rows[0].total) / limit),
    });
  } catch (err) {
    console.error('[Training] Examples fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch examples.' });
  }
});

// ── PATCH /api/training/:instituteId/examples/:id ────────────────────────────
// Approve or reject a specific example.

router.patch('/:instituteId/examples/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { is_approved } = req.body as { is_approved?: boolean };

  if (typeof is_approved !== 'boolean') {
    res.status(400).json({ error: 'is_approved must be a boolean.' });
    return;
  }

  try {
    await pool.query(
      `UPDATE chat_examples SET is_approved = $1 WHERE id = $2`,
      [is_approved, Number(id)],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Training] Update example error:', err);
    res.status(500).json({ error: 'Failed to update example.' });
  }
});

// ── DELETE /api/training/:instituteId/examples/:id ───────────────────────────
// Delete a specific example.

router.delete('/:instituteId/examples/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query(`DELETE FROM chat_examples WHERE id = $1`, [Number(id)]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Training] Delete example error:', err);
    res.status(500).json({ error: 'Failed to delete example.' });
  }
});

// ── DELETE /api/training/:instituteId/reset ───────────────────────────────────
// Wipe all training data for an institute. Used to start fresh.

router.delete('/:instituteId/reset', async (req: Request, res: Response) => {
  const { instituteId } = req.params;

  try {
    await Promise.all([
      pool.query(`DELETE FROM chat_examples WHERE institute_id = $1`, [Number(instituteId)]),
      pool.query(`DELETE FROM institute_personality WHERE institute_id = $1`, [Number(instituteId)]),
      pool.query(`DELETE FROM reply_feedback WHERE institute_id = $1`, [Number(instituteId)]),
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Training] Reset error:', err);
    res.status(500).json({ error: 'Failed to reset training data.' });
  }
});

// ── POST /api/training/:instituteId/feedback ──────────────────────────────────
// Institute owner marks an AI reply as good or bad, optionally providing
// the correct reply. Good replies are auto-added to chat_examples pool.

router.post('/:instituteId/feedback', async (req: Request, res: Response) => {
  const { instituteId } = req.params;
  const { sessionId, studentMessage, aiReply, feedback, correctedReply } =
    req.body as {
      sessionId?: string;
      studentMessage?: string;
      aiReply?: string;
      feedback?: 'good' | 'bad';
      correctedReply?: string;
    };

  if (!sessionId || !studentMessage || !aiReply || !feedback) {
    res.status(400).json({ error: 'sessionId, studentMessage, aiReply, and feedback are required.' });
    return;
  }
  if (!['good', 'bad'].includes(feedback)) {
    res.status(400).json({ error: 'feedback must be "good" or "bad".' });
    return;
  }

  try {
    // Store the feedback
    await pool.query(
      `INSERT INTO reply_feedback (institute_id, session_id, student_message, ai_reply, feedback, corrected_reply)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [Number(instituteId), sessionId, studentMessage, aiReply, feedback, correctedReply ?? null],
    );

    // If marked as "good", automatically add to training examples pool
    if (feedback === 'good') {
      const category = categorisePair(studentMessage, aiReply);
      await pool.query(
        `INSERT INTO chat_examples (institute_id, student_message, owner_reply, category, is_approved)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT DO NOTHING`,
        [Number(instituteId), studentMessage, aiReply, category],
      );
    }

    // If corrected reply provided, add that as a training example instead
    if (correctedReply && correctedReply.trim().length > 5) {
      const category = categorisePair(studentMessage, correctedReply);
      await pool.query(
        `INSERT INTO chat_examples (institute_id, student_message, owner_reply, category, is_approved)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [Number(instituteId), studentMessage, correctedReply.trim(), category],
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Training] Feedback error:', err);
    res.status(500).json({ error: 'Failed to save feedback.' });
  }
});

// ── Exported helpers used by whatsappManager ─────────────────────────────────

/**
 * Retrieves the personality profile for an institute.
 * Returns null if no profile has been generated yet.
 */
export async function getPersonalityProfile(
  instituteId: number,
): Promise<{ profile: string; languageStyle: string } | null> {
  try {
    const result = await pool.query(
      `SELECT profile, language_style FROM institute_personality WHERE institute_id = $1`,
      [instituteId],
    );
    if (!result.rows[0]) return null;
    return {
      profile: result.rows[0].profile as string,
      languageStyle: result.rows[0].language_style as string,
    };
  } catch {
    return null;
  }
}

/**
 * Retrieves the most relevant training examples for a given student message.
 * Uses keyword overlap scoring — no vector DB needed.
 *
 * Scoring: each word in the student message that appears in a stored example
 * adds 1 point. Longer words (>4 chars) get 2 points (more specific).
 * Category bonus: examples matching the detected intent get +3 points.
 * Returns top N examples, deduped.
 */
export async function getRelevantExamples(
  instituteId: number,
  studentMessage: string,
  topN = 4,
): Promise<Array<{ studentMessage: string; ownerReply: string; category: string }>> {
  try {
    // Fetch all approved examples (cap at 200 for scoring)
    const result = await pool.query(
      `SELECT student_message, owner_reply, category
       FROM chat_examples
       WHERE institute_id = $1 AND is_approved = TRUE
       ORDER BY created_at DESC LIMIT 200`,
      [instituteId],
    );

    if (result.rows.length === 0) return [];

    const queryWords = studentMessage
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097F\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);

    const queryCategory = categorisePair(studentMessage, '');

    type ExampleRow = { student_message: string; owner_reply: string; category: string };

    const scored = (result.rows as ExampleRow[]).map(row => {
      const exampleText = (row.student_message + ' ' + row.owner_reply).toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (exampleText.includes(word)) {
          score += word.length > 4 ? 2 : 1;
        }
      }

      // Category match bonus
      if (row.category === queryCategory) score += 3;

      return { ...row, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(({ student_message, owner_reply, category }) => ({
        studentMessage: student_message,
        ownerReply: owner_reply,
        category,
      }));
  } catch {
    return [];
  }
}

export default router;
