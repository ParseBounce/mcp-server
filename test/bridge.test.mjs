import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

const BIN = new URL('../dist/index.js', import.meta.url).pathname;

/** Starts a stub MCP endpoint. `respond(body, req)` returns [status, payload]. */
async function stubServer(respond) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ body, headers: req.headers });

    const [status, payload] = respond(body, requests.length);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  return { url: `http://127.0.0.1:${port}/mcp`, requests, close: () => server.close() };
}

/** Runs the bridge, writes `lines` to stdin, resolves with parsed stdout messages. */
function runBridge(lines, env = {}) {
  const child = spawn(process.execPath, [BIN], {
    env: { ...process.env, PARSEBOUNCE_API_KEY: 'pb_live_test_key', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));

  for (const line of lines) {
    child.stdin.write(`${JSON.stringify(line)}\n`);
  }

  return new Promise((resolve) => {
    // Give the bridge time to round-trip before closing stdin
    setTimeout(() => child.stdin.end(), 400);
    child.on('close', (code) => {
      const messages = stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      resolve({ code, messages, stderr });
    });
  });
}

test('forwards a request and returns the server response', async () => {
  const stub = await stubServer((body) => [
    200,
    { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2024-11-05' } },
  ]);

  const { messages } = await runBridge(
    [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }],
    { PARSEBOUNCE_MCP_URL: stub.url }
  );
  stub.close();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 1);
  assert.equal(messages[0].result.protocolVersion, '2024-11-05');
});

test('sends the API key as a bearer token', async () => {
  const stub = await stubServer((body) => [200, { jsonrpc: '2.0', id: body.id, result: {} }]);

  await runBridge([{ jsonrpc: '2.0', id: 1, method: 'ping' }], { PARSEBOUNCE_MCP_URL: stub.url });
  stub.close();

  assert.equal(stub.requests[0].headers.authorization, 'Bearer pb_live_test_key');
});

test('swallows notifications instead of forwarding them', async () => {
  const stub = await stubServer((body) => [200, { jsonrpc: '2.0', id: body.id, result: {} }]);

  const { messages } = await runBridge(
    [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 1, method: 'ping' },
    ],
    { PARSEBOUNCE_MCP_URL: stub.url }
  );
  stub.close();

  assert.equal(stub.requests.length, 1, 'only the ping should reach the server');
  assert.equal(stub.requests[0].body.method, 'ping');
  assert.equal(messages.length, 1);
});

test('turns 401 into a readable JSON-RPC error', async () => {
  const stub = await stubServer(() => [401, { error: 'unauthorized' }]);

  const { messages } = await runBridge([{ jsonrpc: '2.0', id: 7, method: 'tools/list' }], {
    PARSEBOUNCE_MCP_URL: stub.url,
  });
  stub.close();

  assert.equal(messages[0].id, 7);
  assert.match(messages[0].error.message, /API key/);
});

test('retries once on a 503', async () => {
  const stub = await stubServer((body, attempt) =>
    attempt === 1 ? [503, { error: 'busy' }] : [200, { jsonrpc: '2.0', id: body.id, result: { ok: true } }]
  );

  const { messages } = await runBridge([{ jsonrpc: '2.0', id: 2, method: 'ping' }], {
    PARSEBOUNCE_MCP_URL: stub.url,
  });
  stub.close();

  assert.equal(stub.requests.length, 2);
  assert.equal(messages[0].result.ok, true);
});

test('reports malformed input as a parse error', async () => {
  const stub = await stubServer((body) => [200, { jsonrpc: '2.0', id: body.id, result: {} }]);

  const child = spawn(process.execPath, [BIN], {
    env: { ...process.env, PARSEBOUNCE_API_KEY: 'pb_live_test_key', PARSEBOUNCE_MCP_URL: stub.url },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stdin.write('{ not json }\n');
  setTimeout(() => child.stdin.end(), 200);
  await once(child, 'close');
  stub.close();

  const message = JSON.parse(stdout.trim());
  assert.equal(message.error.code, -32700);
});

test('exits with a helpful message when the API key is missing', async () => {
  const child = spawn(process.execPath, [BIN], {
    env: { ...process.env, PARSEBOUNCE_API_KEY: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const [code] = await once(child, 'close');

  assert.equal(code, 1);
  assert.match(stderr, /PARSEBOUNCE_API_KEY/);
});
