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
  const match = url.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

/** Build the Figma embed URL from the original URL the user pasted. */
function buildEmbedUrl(originalUrl) {
  return `https://www.figma.com/embed?embed_host=figma-to-react&url=${encodeURIComponent(originalUrl)}`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

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
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/suggest
 * Body: { specs: string, changeRequest: string }
 * Returns: { suggestions: string }
 *
 * Sends the design specs + user's plain-English change request to Claude.
 * Claude returns a structured list of suggested changes (not code yet).
 */
app.post('/api/suggest', async (req, res) => {
  const { specs, changeRequest } = req.body;
  if (!specs || !changeRequest?.trim()) {
    return res.status(400).json({ error: 'specs and changeRequest are both required.' });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system:
        'You are a design-to-code assistant helping a non-technical user review a Figma design before it is turned into a React component. ' +
        'Given design specs and a plain-English change request, produce a clear, numbered list of specific changes to apply. ' +
        'Write as if briefing a developer — be precise about colors, sizes, layout, copy, and component behavior. ' +
        'Do not write any code. Output only the numbered list.',
      messages: [
        {
          role: 'user',
          content:
            `Design specs:\n${specs}\n\nChange request from user:\n"${changeRequest}"\n\n` +
            'List the specific changes to make to the React component:',
        },
      ],
    });

    const suggestions = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/generate
 * Body: { prompt: string, specs: string, approvedChanges?: string }
 * Returns: { code: string }
 *
 * Generates the final React component. If approvedChanges is provided
 * (from the suggest step), it is appended to the prompt.
 */
app.post('/api/generate', async (req, res) => {
  const { prompt, specs, approvedChanges } = req.body;
  if (!specs) {
    return res.status(400).json({ error: 'specs is required.' });
  }

  const fullPrompt = [
    prompt?.trim() || 'Generate a React component that matches the design',
    approvedChanges?.trim() ? `\n\nApproved changes to apply:\n${approvedChanges}` : '',
  ].join('');

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
