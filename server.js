import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { getDesignSpecsViaREST, getDesignSpecsViaMCP } from './src/figma-mcp.js';
import { generateReactComponent } from './src/generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract a Figma file key from any Figma URL format. */
function parseFileKey(url) {
  const match = url.match(/figma\.com\/(?:design|file|proto|make)\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

/** Build the Figma embed URL from the original URL the user pasted. */
function buildEmbedUrl(originalUrl) {
  return `https://www.figma.com/embed?embed_host=figma-to-react&url=${encodeURIComponent(originalUrl)}`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/expand-prompt
 * Body: { idea: string }
 * Returns: { prompt: string }
 *
 * Takes a rough plain-English UI idea and expands it into a structured,
 * PRD-style prompt optimised for Figma Make.
 */
app.post('/api/expand-prompt', async (req, res) => {
  const { idea } = req.body;
  if (!idea?.trim()) {
    return res.status(400).json({ error: 'A UI description is required.' });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1500,
      system: `You are an expert at writing prompts for Figma Make, Figma's AI-powered UI design generation tool. When a user describes a UI idea, you expand it into a detailed, structured design brief that Figma Make can use to generate a polished, complete design.

Your output must be a single ready-to-paste prompt. Structure it with these clearly labelled sections:

**UI Overview** — 2–3 sentences describing the interface, its purpose, and the target user.

**Key Components & Layout** — A concise breakdown of the main UI elements (e.g. nav, hero, form fields, cards) and how they are arranged on the page.

**Color & Typography** — A specific color palette (provide hex values where possible) and type guidance: font style, heading sizes, body size, and weight usage.

**Interaction States** — How interactive elements behave: hover, focus, active, error, empty state, and loading state where relevant.

**Responsive Behavior** — Notes on how the layout should adapt from desktop to tablet to mobile.

Write in clear, direct language as if briefing a senior UI designer. Be specific and opinionated — vague instructions produce weak designs. Output only the structured prompt with no preamble, sign-off, or meta-commentary.`,
      messages: [{ role: 'user', content: idea.trim() }],
    });

    const prompt = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    res.json({ prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/extract
 * Body: { url: string }
 * Returns: { fileKey, embedUrl, specs }
 *
 * Parses the file key from the URL, fetches design specs via REST API,
 * and builds the embed URL for the Figma iframe.
 */
app.post('/api/extract', async (req, res) => {
  const { url } = req.body;
  if (!url?.trim()) {
    return res.status(400).json({ error: 'A Figma URL is required.' });
  }

  const fileKey = parseFileKey(url);
  if (!fileKey) {
    return res.status(400).json({
      error: 'Could not find a file key in that URL. Make sure it looks like figma.com/design/… or figma.com/file/…',
    });
  }

  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'FIGMA_ACCESS_TOKEN is not configured on the server.' });
  }

  try {
    // Try MCP first (if OAuth token is cached), fall back to REST
    let specs;
    if (process.env.FIGMA_OAUTH_TOKEN) {
      try {
        specs = await getDesignSpecsViaMCP(process.env.FIGMA_OAUTH_TOKEN, fileKey);
      } catch {
        specs = await getDesignSpecsViaREST(token, fileKey);
      }
    } else {
      specs = await getDesignSpecsViaREST(token, fileKey);
    }

    res.json({
      fileKey,
      embedUrl: buildEmbedUrl(url.trim()),
      specs,
    });
  } catch (err) {
    const msg = err.message ?? String(err);
    if (msg.includes('403') || msg.includes('Forbidden')) {
      return res.status(403).json({
        error: 'Access denied. Make sure your FIGMA_ACCESS_TOKEN has access to this file.',
      });
    }
    if (msg.includes('404') || msg.includes('Not Found')) {
      return res.status(404).json({ error: 'Figma file not found. Double-check the URL.' });
    }
    if (msg.includes('not supported')) {
      return res.status(422).json({
        error:
          'Figma Make files cannot be read directly via the REST API. ' +
          'In Figma Make, click the Figma logo → "Open in Figma" to get a standard design URL (figma.com/design/…), then paste that URL here.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/generate
 * Body: { specs: string }
 * Returns: { code: string }
 *
 * Generates a React component from the design specs using Claude.
 */
app.post('/api/generate', async (req, res) => {
  const { specs } = req.body;
  if (!specs) {
    return res.status(400).json({ error: 'specs is required.' });
  }

  const fullPrompt = 'Generate a React component that faithfully matches the design';

  try {
    const code = await generateReactComponent(fullPrompt, specs);
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\nFigma → React app running at http://localhost:${PORT}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nERROR: Port ${PORT} is already in use.\nSet a different port with: PORT=<number> node server.js\n`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
