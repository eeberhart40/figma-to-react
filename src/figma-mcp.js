/**
 * Figma MCP client — connects to mcp.figma.com via Streamable HTTP transport.
 *
 * create_new_file  – creates a blank Figma file, returns its file key
 * getDesignSpecs   – reads design data from an existing file
 * getSpecsViaREST  – REST API fallback when MCP isn't available
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Pull a Figma file key out of whatever the MCP tool returned. */
function extractFileKey(rawText) {
  if (typeof rawText !== 'string') rawText = JSON.stringify(rawText);

  // figma.com/design/<KEY> or figma.com/file/<KEY>
  const urlMatch = rawText.match(/figma\.com\/(?:design|file)\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  // JSON field: fileKey / file_key / key / id
  try {
    const data = JSON.parse(rawText);
    const key = data?.fileKey ?? data?.file_key ?? data?.key ?? data?.id;
    if (key && typeof key === 'string') return key;
  } catch { /* not JSON */ }

  // Bare key: 10–40 alphanumeric/dash/underscore chars
  const keyMatch = rawText.match(/\b([A-Za-z0-9_-]{10,40})\b/);
  if (keyMatch) return keyMatch[1];

  return null;
}

/** Flatten MCP content blocks to a plain string. */
function contentToText(content) {
  if (!content) return '';
  if (Array.isArray(content)) {
    return content
      .map((b) => (b.type === 'text' ? b.text : JSON.stringify(b)))
      .join('\n');
  }
  return typeof content === 'string' ? content : JSON.stringify(content);
}

/** Build a connected MCP client for mcp.figma.com. */
async function buildClient(oauthToken) {
  const transport = new StreamableHTTPClientTransport(
    new URL(FIGMA_MCP_URL),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${oauthToken}` },
      },
    }
  );

  const client = new Client(
    { name: 'figma-to-react', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Create a new blank Figma file via the remote MCP server.
 * Returns the file key of the newly created file.
 */
export async function createFigmaFile(oauthToken, fileName) {
  console.log('[MCP] Connecting to mcp.figma.com...');
  const client = await buildClient(oauthToken);

  try {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    console.log(`[MCP] Available tools: ${toolNames.join(', ')}`);

    if (!toolNames.includes('create_new_file')) {
      throw new Error(
        `"create_new_file" not found in remote MCP tool list.\n` +
        `  Available tools: ${toolNames.join(', ')}\n` +
        `  This usually means your OAuth app does not have the mcp:connect scope.`
      );
    }

    console.log(`[MCP] Calling create_new_file("${fileName}")...`);
    const result = await client.callTool({
      name: 'create_new_file',
      arguments: { name: fileName },
    });

    const rawText = contentToText(result.content);
    console.log(`[MCP] create_new_file response: ${rawText.slice(0, 200)}`);

    const fileKey = extractFileKey(rawText);
    if (!fileKey) {
      throw new Error(`Could not extract file key from response:\n${rawText}`);
    }

    console.log(`[MCP] ✓ File created. Key: ${fileKey}`);
    return fileKey;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Read design specs from an existing Figma file via the remote MCP server.
 */
export async function getDesignSpecsViaMCP(oauthToken, fileKey) {
  console.log('[MCP] Reading design specs...');
  const client = await buildClient(oauthToken);

  try {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    const preferred = ['get_figma_data', 'getFile', 'get_file', 'figma_get_file', 'read_file'];
    const tool =
      preferred.find((n) => toolNames.includes(n)) ??
      toolNames.find((n) => /file|data|read/i.test(n));

    if (!tool) {
      throw new Error(`No file-read tool found. Available: ${toolNames.join(', ')}`);
    }

    console.log(`[MCP] Calling "${tool}" for file ${fileKey}...`);
    const result = await client.callTool({ name: tool, arguments: { fileKey } });
    const text = contentToText(result.content);

    console.log('[MCP] ✓ Design specs retrieved.');
    return text;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Fallback: read design specs via the Figma REST API using a Personal Access Token.
 */
export async function getDesignSpecsViaREST(patToken, fileKey) {
  console.log('[REST] Reading specs via Figma REST API...');

  const headers = { 'X-Figma-Token': patToken };
  const base = 'https://api.figma.com/v1';

  const get = async (url) => {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Figma REST ${res.status} ${res.statusText}: ${await res.text()}`);
    return res.json();
  };

  const [fileData, components, styles] = await Promise.all([
    get(`${base}/files/${fileKey}`),
    get(`${base}/files/${fileKey}/components`),
    get(`${base}/files/${fileKey}/styles`),
  ]);

  const specs = {
    fileName:     fileData.name,
    lastModified: fileData.lastModified,
    pages: fileData.document?.children?.map((page) => ({
      name:   page.name,
      frames: page.children?.slice(0, 20)?.map((f) => ({
        name:   f.name,
        type:   f.type,
        width:  f.absoluteBoundingBox?.width,
        height: f.absoluteBoundingBox?.height,
        children: f.children?.slice(0, 30)?.map((c) => ({
          name:                c.name,
          type:                c.type,
          characters:          c.characters,
          fills:               c.fills,
          style:               c.style,
          absoluteBoundingBox: c.absoluteBoundingBox,
        })),
      })),
    })),
    components: components.meta?.components?.slice(0, 30)?.map((c) => ({
      name: c.name, description: c.description, key: c.key,
    })),
    styles: styles.meta?.styles?.slice(0, 30)?.map((s) => ({
      name: s.name, styleType: s.style_type,
    })),
  };

  console.log('[REST] ✓ Design specs retrieved.');
  return JSON.stringify(specs, null, 2);
}
