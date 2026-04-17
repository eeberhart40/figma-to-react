/**
 * Figma OAuth 2.0 + PKCE flow
 *
 * Prerequisites (one-time setup):
 *   1. Go to https://www.figma.com/developers/apps → "Create new app"
 *   2. Add redirect URI: http://localhost:7895/callback
 *   3. Copy your Client ID into .env as FIGMA_CLIENT_ID
 *
 * On first run the pipeline opens your browser for authorization.
 * The access token and refresh token are cached in .env automatically.
 */

import { randomBytes, createHash } from 'crypto';
import http from 'http';
import { exec } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

const FIGMA_AUTH_URL = 'https://www.figma.com/oauth';
const FIGMA_TOKEN_URL = 'https://api.figma.com/v1/oauth/token';
const CALLBACK_PORT = 7895;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

// mcp:connect is needed for the remote MCP server;
// file_read lets us fall back to REST API calls
const SCOPES = 'mcp:connect file_read';

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── Browser opener ────────────────────────────────────────────────────────────

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32'  ? `start "" "${url}"` :
                                    `xdg-open "${url}"`;
  exec(cmd);
}

// ── Local callback server ─────────────────────────────────────────────────────

function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      const code  = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });

      if (error) {
        res.end(`<h1>Authorization failed: ${error}</h1><p>You can close this tab.</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error} — ${url.searchParams.get('error_description') ?? ''}`));
        return;
      }

      if (code) {
        res.end(
          '<h1 style="font-family:sans-serif;color:#18A0FB">Authorization successful!</h1>' +
          '<p>You can close this tab and return to the terminal.</p>'
        );
        setTimeout(() => server.close(), 500);
        resolve(code);
      }
    });

    server.on('error', (err) => reject(new Error(`Callback server error: ${err.message}`)));
    server.listen(CALLBACK_PORT, () => {
      console.log(`[Auth] Callback server listening on port ${CALLBACK_PORT}`);
    });
  });
}

// ── Token caching ─────────────────────────────────────────────────────────────

function cacheTokens(accessToken, refreshToken) {
  let env = readFileSync(ENV_PATH, 'utf8');

  const upsert = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(env)) {
      env = env.replace(re, `${key}=${value}`);
    } else {
      env = env.trimEnd() + `\n${key}=${value}\n`;
    }
  };

  upsert('FIGMA_OAUTH_TOKEN', accessToken);
  if (refreshToken) upsert('FIGMA_OAUTH_REFRESH_TOKEN', refreshToken);

  writeFileSync(ENV_PATH, env);
  // Also update the live process so we don't re-auth mid-run
  process.env.FIGMA_OAUTH_TOKEN = accessToken;
  if (refreshToken) process.env.FIGMA_OAUTH_REFRESH_TOKEN = refreshToken;
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function tryRefresh(clientId, refreshToken) {
  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     clientId,
  });

  const res = await fetch(FIGMA_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params,
  });

  if (!res.ok) return null;
  return res.json();
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getOAuthToken() {
  const {
    FIGMA_OAUTH_TOKEN,
    FIGMA_OAUTH_REFRESH_TOKEN,
    FIGMA_CLIENT_ID,
  } = process.env;

  // ① Return cached access token if present
  if (FIGMA_OAUTH_TOKEN) {
    console.log('[Auth] Using cached OAuth token.');
    return FIGMA_OAUTH_TOKEN;
  }

  // ② Need a client ID for everything below
  if (!FIGMA_CLIENT_ID) {
    throw new Error(
      'FIGMA_CLIENT_ID is not set.\n\n' +
      '  One-time setup:\n' +
      '  1. Visit https://www.figma.com/developers/apps\n' +
      '  2. Click "Create new app"\n' +
      '  3. Add redirect URI: http://localhost:7895/callback\n' +
      '  4. Enable scope: mcp:connect (and file_read)\n' +
      '  5. Add FIGMA_CLIENT_ID=<your_client_id> to .env\n'
    );
  }

  // ③ Try refresh token
  if (FIGMA_OAUTH_REFRESH_TOKEN) {
    console.log('[Auth] Trying token refresh...');
    try {
      const data = await tryRefresh(FIGMA_CLIENT_ID, FIGMA_OAUTH_REFRESH_TOKEN);
      if (data?.access_token) {
        cacheTokens(data.access_token, data.refresh_token ?? FIGMA_OAUTH_REFRESH_TOKEN);
        console.log('[Auth] ✓ Token refreshed successfully.');
        return data.access_token;
      }
    } catch (e) {
      console.log(`[Auth] Refresh failed (${e.message}), starting fresh auth...`);
    }
  }

  // ④ Full PKCE authorization flow
  const verifier   = generateCodeVerifier();
  const challenge  = generateCodeChallenge(verifier);

  const authUrl = new URL(FIGMA_AUTH_URL);
  authUrl.searchParams.set('client_id',              FIGMA_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',           REDIRECT_URI);
  authUrl.searchParams.set('scope',                  SCOPES);
  authUrl.searchParams.set('response_type',          'code');
  authUrl.searchParams.set('code_challenge',         challenge);
  authUrl.searchParams.set('code_challenge_method',  'S256');

  console.log('\n[Auth] Opening browser for Figma authorization...');
  console.log(`[Auth] If the browser doesn't open automatically, visit:\n  ${authUrl}\n`);
  openBrowser(authUrl.toString());

  const code = await waitForCallback();
  console.log('[Auth] ✓ Authorization code received.');

  // Exchange code for tokens
  const tokenParams = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  REDIRECT_URI,
    client_id:     FIGMA_CLIENT_ID,
    code_verifier: verifier,
  });

  const tokenRes = await fetch(FIGMA_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    tokenParams,
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed (HTTP ${tokenRes.status}): ${body}`);
  }

  const tokenData = await tokenRes.json();
  cacheTokens(tokenData.access_token, tokenData.refresh_token);
  console.log('[Auth] ✓ OAuth token obtained and cached to .env.\n');

  return tokenData.access_token;
}
