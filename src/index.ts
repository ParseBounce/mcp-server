#!/usr/bin/env node
/**
 * @parsebounce/mcp-server
 *
 * Bridges a local stdio MCP client (Cursor, VS Code, Claude Desktop, Windsurf,
 * Continue.dev, ...) to the ParseBounce remote MCP server over HTTPS.
 *
 * Tools live on the server, so new ones show up without upgrading this package.
 */

const VERSION = '1.0.0';
const DEFAULT_ENDPOINT = 'https://api.parsebounce.com/mcp';
const DEFAULT_TIMEOUT_MS = 60_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface Config {
  apiKey: string;
  endpoint: string;
  timeoutMs: number;
  debug: boolean;
}

function debugLog(config: Config, ...args: unknown[]): void {
  if (config.debug) {
    console.error('[parsebounce-mcp]', ...args);
  }
}

function printHelp(): void {
  console.error(`@parsebounce/mcp-server v${VERSION}

Connects an MCP client to ParseBounce — email bounce, complaint and
deliverability data for AWS SES, SendGrid, Mailgun, SparkPost, Postmark
and Mandrill.

Usage:
  npx -y @parsebounce/mcp-server [--api-key <key>]

Environment:
  PARSEBOUNCE_API_KEY    API key from https://parsebounce.com/dashboard/profile (required)
  PARSEBOUNCE_MCP_URL    Override the endpoint (default: ${DEFAULT_ENDPOINT})
  PARSEBOUNCE_TIMEOUT    Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS})
  PARSEBOUNCE_DEBUG      Set to 1 to log protocol traffic to stderr

Client config:
  {
    "mcpServers": {
      "parsebounce": {
        "command": "npx",
        "args": ["-y", "@parsebounce/mcp-server"],
        "env": { "PARSEBOUNCE_API_KEY": "pb_live_..." }
      }
    }
  }

Docs: https://parsebounce.com/docs/api/mcp`);
}

function loadConfig(argv: string[]): Config {
  let apiKey = process.env.PARSEBOUNCE_API_KEY?.trim() || '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--version' || arg === '-v') {
      console.log(VERSION);
      process.exit(0);
    }
    if (arg === '--api-key') {
      apiKey = (argv[++i] || '').trim();
    } else if (arg.startsWith('--api-key=')) {
      apiKey = arg.slice('--api-key='.length).trim();
    }
  }

  if (!apiKey) {
    console.error(
      `@parsebounce/mcp-server: missing API key.\n\n` +
        `Set PARSEBOUNCE_API_KEY in your MCP client config, or pass --api-key.\n` +
        `Create a key at https://parsebounce.com/dashboard/profile\n\n` +
        `Run with --help for a config example.`
    );
    process.exit(1);
  }

  if (!apiKey.startsWith('pb_live_')) {
    console.error(
      `@parsebounce/mcp-server: warning — API keys normally start with "pb_live_". ` +
        `Continuing anyway.`
    );
  }

  const timeoutRaw = Number(process.env.PARSEBOUNCE_TIMEOUT);

  return {
    apiKey,
    endpoint: process.env.PARSEBOUNCE_MCP_URL?.trim() || DEFAULT_ENDPOINT,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS,
    debug: process.env.PARSEBOUNCE_DEBUG === '1' || process.env.PARSEBOUNCE_DEBUG === 'true',
  };
}

/** Writes one newline-delimited JSON-RPC message to stdout. */
function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResponse(id: string | number | null, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function post(config: Config, payload: unknown): Promise<Response> {
  return fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'User-Agent': `parsebounce-mcp-server/${VERSION} node/${process.versions.node}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
}

/** Forwards one request and writes the server's response. Never throws. */
async function forward(config: Config, request: JsonRpcMessage): Promise<void> {
  const id = request.id ?? null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      debugLog(config, `retrying ${request.method}`);
    }

    let response: Response;
    try {
      response = await post(config, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 0) continue;
      errorResponse(id, -32603, `Cannot reach ParseBounce (${config.endpoint}): ${message}`);
      return;
    }

    if (response.status === 401) {
      errorResponse(
        id,
        -32000,
        'ParseBounce rejected the API key. Create a new one at https://parsebounce.com/dashboard/profile'
      );
      return;
    }

    if (RETRYABLE_STATUS.has(response.status) && attempt === 0) {
      continue;
    }

    const text = await response.text();

    if (!response.ok) {
      errorResponse(id, -32603, `ParseBounce returned HTTP ${response.status}: ${text.slice(0, 300)}`);
      return;
    }

    try {
      const parsed = JSON.parse(text);
      debugLog(config, `<- ${request.method}`);
      send(parsed);
    } catch {
      errorResponse(id, -32700, `ParseBounce returned invalid JSON: ${text.slice(0, 300)}`);
    }
    return;
  }
}

function handleMessage(config: Config, line: string): void {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line);
  } catch {
    errorResponse(null, -32700, 'Parse error');
    return;
  }

  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    errorResponse(null, -32600, 'Invalid Request: expected a single JSON-RPC object');
    return;
  }

  debugLog(config, `-> ${message.method}`);

  // Notifications get no response, and the server has no handler for them
  if (message.id === undefined || message.id === null) {
    return;
  }

  track(forward(config, message));
}

/** In-flight requests, so a stdin close doesn't drop responses on the floor. */
const pending = new Set<Promise<void>>();
let stdinClosed = false;

function track(promise: Promise<void>): void {
  pending.add(promise);
  void promise.finally(() => {
    pending.delete(promise);
    if (stdinClosed && pending.size === 0) {
      process.exit(0);
    }
  });
}

function main(): void {
  const config = loadConfig(process.argv.slice(2));
  debugLog(config, `bridging stdio -> ${config.endpoint}`);

  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;

    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        handleMessage(config, line);
      }
    }
  });

  process.stdin.on('end', () => {
    stdinClosed = true;
    if (pending.size === 0) {
      process.exit(0);
    }
    // Never hang past one request timeout waiting on stragglers
    setTimeout(() => process.exit(0), config.timeoutMs + 2_000).unref();
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main();
