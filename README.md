# ParseBounce MCP Server

[![npm version](https://img.shields.io/npm/v/@parsebounce/mcp-server.svg)](https://www.npmjs.com/package/@parsebounce/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants access to your
email deliverability data — **bounces, spam complaints, suppression lists, delivery stats
and campaigns** — across AWS SES, SendGrid, Mailgun, SparkPost, Postmark and Mandrill.

Ask Claude, Cursor or any MCP client things like:

> *"Why did our welcome emails bounce yesterday?"*
> *"Is support@acme.com on the suppression list?"*
> *"Compare our bounce rate this week against last week."*
> *"What's our Gmail delivery rate?"*

Powered by [ParseBounce](https://parsebounce.com) — email bounce and complaint tracking for
any email provider.

## Quick start

Create an API key at [parsebounce.com/dashboard/profile](https://parsebounce.com/dashboard/profile),
then add this to your MCP client config:

```json
{
  "mcpServers": {
    "parsebounce": {
      "command": "npx",
      "args": ["-y", "@parsebounce/mcp-server"],
      "env": {
        "PARSEBOUNCE_API_KEY": "pb_live_..."
      }
    }
  }
}
```

Restart your client. That's it — no install, no build step.

### Where the config file lives

| Client | Config file |
| --- | --- |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `claude mcp add parsebounce -- npx -y @parsebounce/mcp-server` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code (Copilot) | `.vscode/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Continue.dev | `~/.continue/config.json` |

### Zero-install alternative

Claude Desktop, Claude Code and ChatGPT support **remote MCP** with OAuth — no npm package
and no API key needed. Point them at:

```
https://api.parsebounce.com/mcp
```

You'll be asked to sign in to ParseBounce and approve access. Use this package when your
client only speaks stdio.

## Tools

### Delivery & diagnostics

| Tool | What it does |
| --- | --- |
| `list_projects` | List projects you have access to (start here for project IDs) |
| `check_email` | Suppression status plus the full delivery/bounce/complaint history for an address |
| `check_emails_batch` | Check suppression status for up to 100 addresses at once |
| `get_deliverability_stats` | Delivery, bounce and complaint rates for a project |
| `list_recent_bounces` | Recent bounces with reasons |
| `search_by_domain` | Messages by recipient domain — diagnose Gmail/Yahoo/Outlook issues |
| `search_by_tracking_id` | Messages by campaign or batch identifier |
| `get_message_events` | Full event timeline for one message |
| `compare_periods` | Compare metrics between two time periods to spot trends |

### Suppression list

| Tool | What it does |
| --- | --- |
| `list_suppressions` | List suppressed addresses |
| `add_suppression` | Block an address from receiving mail |
| `remove_suppression` | Unblock an address |

### Reputation

| Tool | What it does |
| --- | --- |
| `check_email_reputation` | Crowdsourced risk level (safe/risky/bad) for an address before you send |
| `get_domain_reputation` | Aggregate bounce and complaint data for a domain |

### Sending

| Tool | What it does |
| --- | --- |
| `get_verified_senders` | Verified sender domains and addresses |
| `get_campaigns` | List campaigns, optionally filtered by status |
| `get_campaign_stats` | Sent / opened / clicked / bounced counts for a campaign |
| `get_lists` | Contact lists |
| `get_templates` | Email templates |
| `search_contact` | Find a contact by address within a list |
| `get_sending_usage` | Current month usage against plan limits |
| `get_sending_timeseries` | Sending volume over time (sent vs failed) |
| `get_transactional_sends` | Recent transactional sends |
| `send_transactional_email` | Send a single transactional email |
| `create_and_send_campaign` | Create a campaign and start sending |
| `pause_campaign` / `resume_campaign` / `cancel_campaign` | Control a running campaign |

Tools that send mail or change state are annotated so your client asks for confirmation
first.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PARSEBOUNCE_API_KEY` | — | **Required.** Your `pb_live_...` key |
| `PARSEBOUNCE_MCP_URL` | `https://api.parsebounce.com/mcp` | Override the endpoint |
| `PARSEBOUNCE_TIMEOUT` | `60000` | Request timeout in ms |
| `PARSEBOUNCE_DEBUG` | — | Set to `1` to log protocol traffic to stderr |

The key can also be passed as `--api-key <key>`. Run with `--help` for a config example.

## How it works

This package is a thin bridge, not a reimplementation:

```
MCP client  ──stdio (JSON-RPC)──▶  @parsebounce/mcp-server  ──HTTPS──▶  api.parsebounce.com/mcp
```

It reads newline-delimited JSON-RPC from stdin, forwards each request to the ParseBounce
MCP endpoint with your API key, and writes responses back to stdout. Every tool runs
server-side, which means:

- **No version drift** — new tools appear without upgrading this package
- **Zero runtime dependencies** — nothing but Node's built-in `fetch`
- **Nothing stored locally** — your key goes straight to the API over TLS

Requires Node.js 18 or newer.

## Security

Your API key grants full access to your ParseBounce account. Keep it in your MCP client's
`env` block rather than in a committed file, and revoke it from the
[dashboard](https://parsebounce.com/dashboard/profile) if it leaks. Keys are transmitted
only to `api.parsebounce.com` over HTTPS and are never written to disk or logged.

## Links

- [MCP documentation](https://parsebounce.com/docs/api/mcp)
- [ParseBounce MCP overview](https://parsebounce.com/mcp)
- [REST API reference](https://parsebounce.com/docs/api)
- [Free email deliverability checker](https://parsebounce.com/check)

## License

MIT © [ParseBounce](https://parsebounce.com)
