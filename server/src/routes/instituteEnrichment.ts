import OpenAI from 'openai';
import pool from '../db';

// ── Lazy OpenAI/Groq client ──────────────────────────────────────────────────

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

// ── Fetch website HTML (best-effort, returns null on failure) ────────────────

async function fetchWebsiteText(url: string): Promise<string | null> {
  try {
    // Normalise URL
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const res = await fetch(fullUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadCaptureBot/1.0)' },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const html = await res.text();

    // Strip HTML tags and collapse whitespace to get readable text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Limit to first 6000 chars to stay within Groq token limits
    return text.slice(0, 6000);
  } catch {
    return null;
  }
}

// ── Ask Groq to extract structured institute info ────────────────────────────

async function extractInstituteData(
  instituteName: string,
  websiteText: string | null,
): Promise<string> {
  const client = getOpenAI();

  const sourceInfo = websiteText
    ? `Website content (extracted text):\n${websiteText}`
    : `No website was provided. Use only your general knowledge about "${instituteName}" if available, otherwise state that details are not available.`;

  const prompt =
    `You are a data extraction assistant. Extract and summarise information about the following educational institute.\n\n` +
    `Institute Name: ${instituteName}\n\n` +
    `${sourceInfo}\n\n` +
    `Please extract and structure the following information (skip any section if data is not available):\n` +
    `1. About / Overview (founding year, type, location, accreditation)\n` +
    `2. Courses & Programs offered\n` +
    `3. Admission process & eligibility criteria\n` +
    `4. Fees & scholarships\n` +
    `5. Placements & career opportunities\n` +
    `6. Infrastructure & facilities\n` +
    `7. Notable achievements, rankings, or reputation\n` +
    `8. Contact information\n\n` +
    `Write in plain text paragraphs. Be factual and concise. Do not invent information that is not present.`;

  const completion = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1500,
  });

  return completion.choices[0]?.message?.content ?? 'No data could be extracted.';
}

// ── Ensure institute_details table exists ────────────────────────────────────

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS institute_details (
      id            SERIAL PRIMARY KEY,
      institute_id  INTEGER NOT NULL UNIQUE REFERENCES institutes(id) ON DELETE CASCADE,
      institute_data TEXT NOT NULL,
      scraped_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── Main export: scrape + enrich + save ─────────────────────────────────────

export async function scrapeAndEnrich(
  instituteId: number,
  instituteName: string,
  website?: string | null,
): Promise<void> {
  try {
    await ensureTable();

    console.log(`[Enrich] Starting enrichment for institute ${instituteId} (${instituteName})`);

    // Fetch website content if URL provided
    const websiteText = website ? await fetchWebsiteText(website) : null;
    if (website && !websiteText) {
      console.warn(`[Enrich] Could not fetch website for institute ${instituteId}: ${website}`);
    }

    // Extract structured data via Groq
    const instituteData = await extractInstituteData(instituteName, websiteText);

    // Save to DB (upsert — safe to re-run)
    await pool.query(
      `INSERT INTO institute_details (institute_id, institute_data, scraped_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (institute_id)
       DO UPDATE SET institute_data = EXCLUDED.institute_data, scraped_at = NOW()`,
      [instituteId, instituteData],
    );

    console.log(`[Enrich] Enrichment complete for institute ${instituteId}`);
  } catch (err) {
    // Non-fatal — log and continue. Institute is registered even if enrichment fails.
    console.error(`[Enrich] Failed for institute ${instituteId}:`, err);
  }
}

// ── Fetch stored institute details for use in AI prompt ─────────────────────

export async function getInstituteDetails(instituteId: number): Promise<string | null> {
  try {
    await ensureTable();
    const result = await pool.query(
      'SELECT institute_data FROM institute_details WHERE institute_id = $1',
      [instituteId],
    );
    return result.rows[0]?.institute_data ?? null;
  } catch {
    return null;
  }
}
