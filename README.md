# Commerce Operations MCP

An MCP server that gives an AI assistant a safe operational interface for investigating delayed or blocked ecommerce orders. Reference data is synthetic — no real orders, credentials, or integrations required — while escalations and the audit trail are stored durably in PostgreSQL.

The server is read-only except for `create_escalation`, which records a human-review escalation and an audit entry. It never retries fulfillment, reroutes/cancels orders, edits addresses, or issues refunds.

## Setup

Requirements: Node.js >= 20.

```bash
npm install
npm run dev        # starts on http://127.0.0.1:3001/mcp
```

Set `DATABASE_URL` to a PostgreSQL connection string to enable durable escalations/audit. Without it, the server falls back to in-memory state (fine for local dev and the default test run).

Other scripts:

```bash
npm test           # unit + e2e tests (Postgres integration tests run only with DATABASE_URL set)
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

## Persistence

Escalations and audit entries are the mutable operational state and are stored in PostgreSQL:

- `escalations` — every created escalation, with a **partial unique index** on `order_id WHERE status IN ('open','in_review')`, so a duplicate open escalation is rejected at the database level even under concurrent writes.
- `audit_logs` — every audit entry, including the reference seed entry, written in the same transaction as its escalation.

Tables are created automatically on startup (`CREATE TABLE IF NOT EXISTS`). The reference audit entry is seeded once when the table is empty. Reference order/payment/inventory/fulfillment data stays synthetic and deterministic; it is re-seeded on startup, while escalations and audit entries survive restarts and redeploys.

When `DATABASE_URL` is not set, a `MemoryPersistence` fallback keeps local development and the default test run dependency-free.

The health endpoint reports the active backend:

```text
GET /  ->  { "ok": true, "persistence": "postgres" | "memory", ... }
```

## Repository Layout

```text
src/
  server.ts                MCP entry, HTTP + Streamable HTTP endpoint
  domain/types.ts          Domain types
  data/store.ts            Store facade (reference data + persistence)
  data/persistence.ts      Persistence interface + memory/Postgres implementations
  data/seed.ts             Synthetic seed data (ORD-1007...ORD-1011)
  services/investigation.ts  Diagnosis + action boundary logic
  services/escalation.ts     Escalation validation, audit write
tests/
  operations-workflow.test.ts  Unit tests for workflow + safety rules
  mcp-e2e.test.ts              End-to-end tests over HTTP
  postgres-integration.test.ts Postgres durability tests (needs DATABASE_URL)
Dockerfile, render.yaml       Deployment
```

## Deployment

Docker: `docker build -t ops-mcp . && docker run -p 3001:3001 ops-mcp`

Render: deploy from `render.yaml` (or via the Render dashboard with build command `npm ci --include=dev && npm run build`, start command `node dist/server.js`). Set `DATABASE_URL` in the service environment for durable state. The server listens on `PORT` (default 3001) and `HOST` (default `0.0.0.0`).

## Notes

- Escalations and audit entries are PostgreSQL-backed and survive restarts and redeploys.
- A duplicate open escalation on the same order is rejected as a safety check, enforced by a database partial unique index.
- Unknown order IDs return clear errors.
