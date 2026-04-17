# Figma → React

A web app that bridges the gap between Figma Make and production-ready React code — built for non-technical users like PMs and designers.

## The problem it solves

Figma Make can generate a UI design from a text prompt in seconds, but there's no way to go from that design to clean React code without a developer. This app adds a simple handoff layer: paste the Figma URL, review the design, and generate the component — or send it back to Figma if it needs more work.

## How it works

**Step 1 — Paste your Figma Make URL**
The app parses the file key automatically from any `figma.com/design/…` or `figma.com/file/…` URL.

**Step 2 — Review the design**
The Figma file is embedded live in the app using Figma's embed API. Alongside it, the app pulls the full design specs (components, styles, layout) from the Figma REST API.

**Step 3 — Approve or iterate**
- **Approve Design** — sends the design specs to Claude, which generates a Tailwind-based React component displayed in the app with syntax highlighting and a copy button.
- **Request Changes in Figma** — opens the file directly in Figma Make (`figma.com/make/FILE_KEY`) so you can iterate on the design and come back with the updated URL.

## Tech stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla HTML/CSS/JS, no build step
- **Design data:** Figma REST API (with optional Figma MCP fallback if an OAuth token is available)
- **Code generation:** Anthropic API (`claude-opus-4-6`)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/eeberhart40/figma-to-react.git
cd figma-to-react
npm install
```

### 2. Configure environment variables

Copy the example and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Where to get it |
|---|---|
| `FIGMA_ACCESS_TOKEN` | figma.com → Settings → Personal access tokens |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |

The `FIGMA_CLIENT_ID` and OAuth token fields are optional. They enable the Figma MCP server as a richer spec source, but the app works fine with just the REST API.

### 3. Run

```bash
npm start
```

Open [http://localhost:4000](http://localhost:4000).

## Project structure

```
figma-to-react/
├── server.js          Express server + API routes
├── src/
│   ├── figma-mcp.js   Figma MCP client + REST API fallback
│   ├── generate.js    React component generation via Anthropic API
│   └── oauth.js       Figma OAuth 2.0 + PKCE flow (optional)
├── public/
│   ├── index.html     Web UI
│   ├── app.js         Frontend logic
│   └── styles.css     Styles
└── pipeline.js        Original CLI pipeline (kept for reference)
```

## API routes

| Route | Purpose |
|---|---|
| `POST /api/extract` | Parses file key, fetches design specs, returns embed URL |
| `POST /api/generate` | Sends specs to Claude, returns React component code |

## Environment variables

```bash
# Required
FIGMA_ACCESS_TOKEN=        # Figma personal access token
ANTHROPIC_API_KEY=         # Anthropic API key

# Optional — enables Figma MCP server as spec source
FIGMA_CLIENT_ID=           # OAuth app client ID (figma.com/developers/apps)
FIGMA_OAUTH_TOKEN=         # Auto-populated after first OAuth login
FIGMA_OAUTH_REFRESH_TOKEN= # Auto-populated after first OAuth login
```

## Known limitations

- **Figma Make has no public API.** There is no way to programmatically trigger AI design generation from a text prompt. The user creates the file in Figma Make manually and pastes the URL.
- **The Figma remote MCP server requires OAuth** with an approved client ID (`mcp:connect` scope). Without it, the app falls back to the Figma REST API for reading specs, which works fine for most use cases.
- **The Figma embed requires a Figma account.** The iframe preview will prompt for login if the user isn't signed into Figma in their browser.
