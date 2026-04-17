/**
 * Figma → React pipeline
 *
 * Usage:
 *   node pipeline.js "a login form with email, password, and a submit button"
 *
 * First-run setup (one time):
 *   1. Go to https://www.figma.com/developers/apps → "Create new app"
 *   2. Set redirect URI:  http://localhost:7895/callback
 *   3. Enable scopes:     mcp:connect, file_read
 *   4. Add to .env:       FIGMA_CLIENT_ID=<your_client_id>
 *
 * After the first OAuth authorization the token is cached in .env and
 * subsequent runs skip the browser step entirely.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getOAuthToken }                    from './src/oauth.js';
import {
  createFigmaFile,
  getDesignSpecsViaMCP,
  getDesignSpecsViaREST,
}                                           from './src/figma-mcp.js';
import { generateReactComponent }           from './src/generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Validate env ──────────────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set in .env');
  process.exit(1);
}

// ── Parse prompt ──────────────────────────────────────────────────────────────

const userPrompt = process.argv.slice(2).join(' ').trim();
if (!userPrompt) {
  console.error('Usage: node pipeline.js "describe the UI component you want"');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a PascalCase filename from the first 4 words of the prompt. */
function deriveComponentName(prompt) {
  return prompt
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function writeOutput(code) {
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const name = deriveComponentName(userPrompt);
  const filePath = path.join(outDir, `${name}.jsx`);
  fs.writeFileSync(filePath, code, 'utf8');
  return filePath;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Figma → React Pipeline');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Prompt: "${userPrompt}"\n`);

  // ── Step 1: OAuth ─────────────────────────────────────────────────────────
  console.log('[Step 1] Getting Figma OAuth token...');
  const oauthToken = await getOAuthToken();

  // ── Step 2: Create Figma file with Make ──────────────────────────────────
  console.log('\n[Step 2] Creating Figma file via remote MCP (create_new_file)...');
  const fileName = userPrompt.slice(0, 60);
  const fileKey  = await createFigmaFile(oauthToken, fileName);
  console.log(`[Step 2] ✓ File key: ${fileKey}`);

  // ── Step 3: Read design specs ─────────────────────────────────────────────
  console.log('\n[Step 3] Extracting design specs...');
  let designSpecs;

  try {
    designSpecs = await getDesignSpecsViaMCP(oauthToken, fileKey);
  } catch (mcpErr) {
    console.log(`[Step 3] MCP read failed (${mcpErr.message}), falling back to REST API...`);
    if (!process.env.FIGMA_ACCESS_TOKEN) {
      throw new Error('REST fallback requires FIGMA_ACCESS_TOKEN in .env');
    }
    designSpecs = await getDesignSpecsViaREST(process.env.FIGMA_ACCESS_TOKEN, fileKey);
  }

  // ── Step 4: Generate React component ────────────────────────────────────
  console.log('\n[Step 4] Generating React component with Claude...');
  const reactCode = await generateReactComponent(userPrompt, designSpecs);

  // ── Step 5: Write output ─────────────────────────────────────────────────
  console.log('\n[Step 5] Writing component to disk...');
  const outputPath = writeOutput(reactCode);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Pipeline complete!');
  console.log(`  Figma file key : ${fileKey}`);
  console.log(`  Output file    : ${outputPath}`);
  console.log('═══════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\nPipeline failed:', err.message);
  process.exit(1);
});
