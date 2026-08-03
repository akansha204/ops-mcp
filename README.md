# Commerce Operations MCP

An MCP server that gives an AI assistant a safe operational interface for investigating delayed or blocked ecommerce orders. Backed entirely by synthetic in-memory data — no real orders, credentials, or integrations required.

The server is read-only except for `create_escalation`, which records a human-review escalation and an audit entry. It never retries fulfillment, reroutes/cancels orders, edits addresses, or issues refunds.

## Setup

Requirements: Node.js >= 20.

```bash
npm install
npm run dev        # starts on http://127.0.0.1:3001/mcp
```

Other scripts:

```bash
npm test           # run unit + e2e tests
npm run build      # compile to dist/
npm start          # run compiled build (node dist/server.js)
```

## Usage

Connect any MCP client over Streamable HTTP. No auth required (synthetic data only).

- **Local**: `http://127.0.0.1:3001/mcp`
- **Hosted**: `https://ops-mcp-qn8w.onrender.com/mcp`

opencode (`opencode.json`):

```json
{
  "mcp": {
    "ops-mcp": {
      "type": "remote",
      "url": "https://ops-mcp-qn8w.onrender.com/mcp",
      "enabled": true
    }
  }
}
```

Claude Desktop / Claude Code:

```json
{
  "mcpServers": {
    "ops-mcp": {
      "type": "http",
      "url": "https://ops-mcp-qn8w.onrender.com/mcp"
    }
  }
}
```

MCP Inspector: open the inspector, select "Connect", paste the URL, connect. Gemini CLI: `gemini mcp add ops-mcp https://ops-mcp-qn8w.onrender.com/mcp --transport http`.

### Tools

| Tool | Purpose |
| --- | --- |
| `search_orders` | Find orders by status, issue type, or customer email |
| `investigate_order` | Diagnosis with evidence and recommended next action |
| `suggest_order_actions` | Allowed vs. approval-required actions (read-only) |
| `create_escalation` | Create + audit a human-review escalation |
| `get_audit_log` | Prior actions and outcomes for an order |

### Sample prompts

Once connected, these work in any client:

```text
Why hasn't order ORD-1007 shipped?
Is it safe to retry fulfillment?
Create a human-review escalation for it.
Show the audit log.
```

`create_escalation` requires a `createdBy` operator email (recorded in the audit log as the authorizing human); any synthetic email works, e.g. `ops@example.test`.

## Repository Layout

```text
src/
  server.ts                MCP entry, HTTP + Streamable HTTP endpoint
  domain/types.ts          Domain types
  data/store.ts            In-memory store + audit helpers
  data/seed.ts             Synthetic seed data (ORD-1007...ORD-1011)
  services/investigation.ts  Diagnosis + action boundary logic
  services/escalation.ts     Escalation validation, audit write
tests/
  operations-workflow.test.ts  Unit tests for workflow + safety rules
  mcp-e2e.test.ts              End-to-end tests over HTTP
Dockerfile, render.yaml       Deployment
```

## Deployment

Docker: `docker build -t ops-mcp . && docker run -p 3001:3001 ops-mcp`

Render: deploy from `render.yaml` (or via the Render dashboard with build command `npm ci --include=dev && npm run build`, start command `node dist/server.js`). The server listens on `PORT` (default 3001) and `HOST` (default `0.0.0.0`).

## Notes

- State is in-memory and resets on restart/redeploy — intentional, for clean repeated demos.
- A duplicate open escalation on the same order is rejected as a safety check.
- Unknown order IDs return clear errors.
