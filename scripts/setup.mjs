#!/usr/bin/env node
/**
 * scripts/setup.mjs
 *
 * First-time project setup helper.
 * Run with:  npm run setup
 *
 * What it does:
 *   1. Creates server/.env from .env.example if it does not already exist
 *   2. Reminds you to add your OpenAI API key
 */

import { existsSync, copyFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = join(__dirname, '..');
const envSrc    = join(root, '.env.example');
const envDest   = join(root, 'server', '.env');

// Read the placeholder value directly from .env.example so it stays in sync
// with server/src/constants.ts and never needs to be updated in two places.
const envExampleContents = readFileSync(envSrc, 'utf-8');
const placeholderMatch   = envExampleContents.match(/OPENAI_API_KEY=(.+)/);
const placeholder        = placeholderMatch?.[1]?.trim() ?? 'your_key_here';

console.log('🔧  AI Admission Assistant — setup\n');

// ── Step 1: Create server/.env ───────────────────────────────────────────────
if (!existsSync(envDest)) {
  copyFileSync(envSrc, envDest);
  console.log('✅  Created server/.env from .env.example');
  console.log('');
  console.log('👉  ACTION REQUIRED:');
  console.log('    Open server/.env and replace the placeholder with your real OpenAI API key.');
  console.log('    Get a key at https://platform.openai.com/api-keys');
  console.log('');
} else {
  const contents = readFileSync(envDest, 'utf-8');
  if (contents.includes(placeholder)) {
    console.log('⚠️   server/.env exists but OPENAI_API_KEY is still a placeholder.');
    console.log('    Open server/.env and replace the placeholder with your actual API key.');
    console.log('');
  } else {
    console.log('✅  server/.env is already configured.');
    console.log('');
  }
}

// ── Step 2: Remind about next steps ─────────────────────────────────────────
console.log('─'.repeat(50));
console.log('Next steps:');
console.log('  1. Edit server/.env  →  set OPENAI_API_KEY=sk-...');
console.log('  2. npm run dev       →  starts both servers');
console.log('     • Client : http://localhost:5173');
console.log('     • API    : http://localhost:3001');
console.log('─'.repeat(50));

