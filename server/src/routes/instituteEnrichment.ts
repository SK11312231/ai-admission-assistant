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

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_PAGES       = 8;       // max pages to crawl per institute
const CHARS_PER_PAGE  = 3000;    // max chars extracted per page
const TOTAL_CHAR_CAP  = 12000;   // max combined chars sent to Groq
const FETCH_TIMEOUT   = 12_000;  // ms per page fetch

// Keywords that suggest a page has useful institute info
// Higher priority = fetched first
const HIGH_PRIORITY_KEYWORDS = [
  'admission', 'course', 'program', 'fee', 'placement',
  'about', 'contact', 'faculty', 'scholarship', 'eligibility',
  'apply', 'enroll', 'infrastructure', 'facility', 'result',
  'department', 'branch', 'exam', 'rank', 'campus',
];

// ── Fetch a single URL → clean text ─────────────────────────────────────────

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadCaptureBot/1.0; +https://leadcapture.in)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return null;

    const html = await res.text();

    // Extract page title
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Strip scripts, styles, nav, footer, header (usually navigation clutter)
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#\d+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const pageText = title ? `[${title}]\n${cleaned}` : cleaned;
    return pageText.slice(0, CHARS_PER_PAGE);
  } catch {
    return null;
  }
}

// ── Extract all internal links from homepage HTML ────────────────────────────

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const links: string[] = [];

  const hrefRegex = /href=["']([^"'#?]+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;

    try {
      const resolved = new URL(raw, baseUrl);

      // Must be same domain
      if (resolved.hostname !== base.hostname) continue;

      // Skip files that aren't HTML pages
      const ext = resolved.pathname.split('.').pop()?.toLowerCase() ?? '';
      if (['pdf', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'mp4', 'mp3'].includes(ext)) continue;

      const normalised = resolved.origin + resolved.pathname.replace(/\/$/, '');
      if (seen.has(normalised)) continue;
      seen.add(normalised);
      links.push(normalised);
    } catch {
      continue;
    }
  }

  return links;
}

// ── Score a URL by how relevant it likely is ─────────────────────────────────

function scoreUrl(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  HIGH_PRIORITY_KEYWORDS.forEach((kw, index) => {
    if (lower.includes(kw)) {
      // Earlier in the list = higher priority
      score += HIGH_PRIORITY_KEYWORDS.length - index;
    }
  });
  // Prefer shorter paths (top-level pages usually more informative)
  const depth = (url.match(/\//g) ?? []).length;
  score -= depth * 0.5;
  return score;
}

// ── Multi-page crawler ───────────────────────────────────────────────────────

async function crawlWebsite(websiteUrl: string): Promise<string | null> {
  const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

  // Step 1: fetch homepage
  console.log(`[Enrich] Fetching homepage: ${baseUrl}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let homepageHtml = '';
  try {
    const res = await fetch(baseUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadCaptureBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    homepageHtml = await res.text();
  } catch {
    clearTimeout(timeout);
    return null;
  }

  // Extract homepage text
  const homepageText = await fetchPageText(baseUrl);
  const pageSections: string[] = [];
  if (homepageText) {
    pageSections.push(`=== HOME PAGE ===\n${homepageText}`);
  }

  // Step 2: extract and rank internal links
  const internalLinks = extractInternalLinks(homepageHtml, baseUrl);
  console.log(`[Enrich] Found ${internalLinks.length} internal links`);

  // Remove homepage itself from list
  const homeNorm = baseUrl.replace(/\/$/, '');
  const otherLinks = internalLinks.filter(l => l !== homeNorm);

  // Sort by relevance score
  const rankedLinks = otherLinks
    .map(url => ({ url, score: scoreUrl(url) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PAGES - 1) // leave 1 slot for homepage
    .map(x => x.url);

  console.log(`[Enrich] Crawling ${rankedLinks.length} additional pages:`, rankedLinks);

  // Step 3: fetch all ranked pages concurrently
  const results = await Promise.allSettled(
    rankedLinks.map(async (url) => {
      const text = await fetchPageText(url);
      return { url, text };
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.text) {
      const { url, text } = result.value;
      // Get a readable page label from the path
      const pathLabel = new URL(url).pathname
        .replace(/\//g, ' ')
        .replace(/[-_]/g, ' ')
        .trim()
        .toUpperCase() || 'PAGE';
      pageSections.push(`=== ${pathLabel} ===\n${text}`);
    }
  }

  if (pageSections.length === 0) return null;

  // Step 4: combine and cap total chars
  const combined = pageSections.join('\n\n');
  console.log(`[Enrich] Total text collected: ${combined.length} chars from ${pageSections.length} pages`);
  return combined.slice(0, TOTAL_CHAR_CAP);
}

// ── Ask Groq to extract structured institute info ────────────────────────────

async function extractInstituteData(
  instituteName: string,
  websiteContent: string | null,
): Promise<string> {
  const client = getOpenAI();

  const sourceInfo = websiteContent
    ? `Website content scraped from multiple pages:\n\n${websiteContent}`
    : `No website was provided. Use only your general knowledge about "${instituteName}" if available, otherwise state that details are not yet available.`;

  const prompt =
    `You are a data extraction assistant helping build a knowledge base for an AI admission chatbot.\n\n` +
    `Institute Name: ${instituteName}\n\n` +
    `${sourceInfo}\n\n` +
    `Extract and structure the following information. Include as much specific detail as possible (course names, fee amounts, eligibility criteria, placement stats, contact numbers etc.). Skip sections only if data is truly absent.\n\n` +
    `1. About / Overview (founding year, type, location, accreditation, recognition)\n` +
    `2. Courses & Programs (list each with duration and level — UG, PG, Diploma etc.)\n` +
    `3. Admission Process & Eligibility (entry criteria, entrance exams accepted, application steps)\n` +
    `4. Fees & Scholarships (per course if available, payment options, scholarships offered)\n` +
    `5. Placements & Career (companies, average package, placement percentage)\n` +
    `6. Infrastructure & Facilities (labs, library, hostel, sports, transport)\n` +
    `7. Faculty & Academic Quality\n` +
    `8. Rankings, Achievements & Reputation\n` +
    `9. Contact Information (phone, email, address, website)\n\n` +
    `Write in plain text. Be specific and factual. Do not invent or assume any information not present in the source.`;

  const completion = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 2000,
  });

  return completion.choices[0]?.message?.content || 'No data could be extracted.';
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

// ── Main export: crawl + enrich + save ───────────────────────────────────────

export async function scrapeAndEnrich(
  instituteId: number,
  instituteName: string,
  website?: string | null,
): Promise<void> {
  try {
    await ensureTable();
    console.log(`[Enrich] Starting for institute ${instituteId} (${instituteName})`);

    // Crawl website (multi-page)
    const websiteContent = website ? await crawlWebsite(website) : null;

    if (website && !websiteContent) {
      console.warn(`[Enrich] Could not fetch any content from ${website}`);
    } else if (websiteContent) {
      console.log(`[Enrich] Successfully collected website content (${websiteContent.length} chars)`);
    }

    // Extract structured data via Groq
    const instituteData = await extractInstituteData(instituteName, websiteContent);

    // Upsert to DB
    await pool.query(
      `INSERT INTO institute_details (institute_id, institute_data, scraped_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (institute_id)
       DO UPDATE SET institute_data = EXCLUDED.institute_data, scraped_at = NOW()`,
      [instituteId, instituteData],
    );

    console.log(`[Enrich] Complete for institute ${instituteId}`);
  } catch (err) {
    console.error(`[Enrich] Failed for institute ${instituteId}:`, err);
  }
}

// ── Fetch stored details for AI prompt ───────────────────────────────────────

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
