# Commerce Operations MCP

An AI-native operations copilot for investigating and resolving delayed or blocked ecommerce orders.

This project is scoped around a remotely hosted Model Context Protocol server. The MCP server is the main product surface: it gives an AI assistant structured access to synthetic commerce operations data and a safe human-review escalation workflow.

## Product Scope

### User

The primary user is an operations associate at an online commerce business.

This user handles customer escalations about delayed, stuck, or unclear orders. They are not expected to query backend systems directly, inspect logs, or ask engineers to trace every issue across payments, inventory, fulfillment, and order history.

### Problem

Operations teams often need engineer help to answer questions like:

- Why has this paid order not shipped?
- Is the issue caused by payment, inventory, fulfillment, or carrier status?
- What action is safe to take next?
- Has someone already attempted a remediation?

The goal is to make operations more independent by giving an AI assistant a reliable operational interface through MCP tools.

### Chosen Workflow

The first workflow focuses on delayed or blocked order investigation.

1. An operations associate asks an AI assistant why an order has not shipped.
2. The assistant calls the hosted MCP server to inspect synthetic order, payment, inventory, fulfillment, event, and audit data.
3. The MCP server returns a structured diagnosis with evidence, detected blockers, and recommended next actions.
4. If remediation is needed, the operations associate asks the assistant to create a human-review escalation.
5. The MCP server validates the escalation against business rules and records an audit entry without mutating fulfillment or order state.

### Demo Scenario

The primary demo scenario will use a synthetic order where:

- The order has been paid.
- Inventory has been reserved.
- Fulfillment failed because a warehouse job timed out.
- The correct next step is to create a human-review fulfillment escalation.
- Direct fulfillment retry is not performed by the MCP.
- The escalation creates an audit log entry.

This scenario exercises the core operational systems without requiring a real commerce backend.

## MCP Role

The MCP server is not a thin wrapper around a single lookup. It is the operational control plane for the assistant.

MCP capabilities (all implemented):

- `search_orders`: find synthetic orders by status, customer email, or issue type.
- `investigate_order`: return a structured investigation across order, payment, inventory, fulfillment, events, and audit history.
- `suggest_order_actions`: return allowed and blocked actions with reasons.
- `create_escalation`: validate and audit a human-review escalation without mutating fulfillment or order state.
- `get_audit_log`: inspect the operational audit history for an order.

Only `create_escalation` executes a write, and only into the escalation and audit collections. Every other tool is read-only. No action is advertised unless a matching tool exists.

## Architecture

```text
AI client / MCP inspector
        |
        | Streamable HTTP
        v
Hosted TypeScript MCP server
        |
        v
Synthetic commerce operations data
        |
        v
Investigation, action validation, and audit services
```

Initial implementation choices:

- TypeScript MCP server using Streamable HTTP.
- Synthetic in-memory data for orders, payments, inventory reservations, fulfillment records, events, and audit logs.
- Zod schemas for tool input validation.
- Focused service functions for investigation, escalation eligibility, and audit logging.
- Vitest coverage for the main workflow and safety rules.

## Safety And Operational Considerations

- Only synthetic data is used.
- No production credentials or real customer data are required.
- Tool inputs are schema-validated.
- MCP remediation is limited to creating human-review escalations.
- The MCP does not retry or requeue fulfillment, reroute or cancel orders, modify addresses, or mutate post-dispatch state.
- The server checks escalation preconditions before writing audit state.
- Every created escalation writes an audit entry.
- Higher-risk actions such as refunds are out of scope for MCP execution and can be represented as requiring human review.
- Unknown or invalid order IDs return clear errors.

## Product Decisions And Assumptions

The main product and scope decisions, made with the assignment giver, are documented here.

- The MCP server is the product surface, not a checkbox integration: the workflow cannot be completed without it.
- Remediation boundary (confirmed by the assignment giver): the MCP gathers evidence, recommends, and creates human-review escalations. It does not retry or requeue fulfillment, reroute or cancel orders, modify addresses, issue refunds, or mutate post-dispatch state.
- `createdBy` on `create_escalation` is required and recorded in the audit log as the human authorizing the escalation. The MCP never fabricates an actor.
- A small, coherent workflow was preferred over a broad product: one end-to-end workflow (delayed or blocked order investigation) with five tools.
- State is in-memory and synthetic. Escalations and audit entries reset when the hosted instance restarts or redeploys. This is intentional: it keeps the submission self-contained and demonstrates clean-slate repeats. A duplicate escalation on the same order is rejected by design as a safety check.
- Deployment provider (Render free tier) is not an evaluation criterion; the hosted URL is what matters.

## Out Of Scope

This assignment intentionally does not include:

- A frontend or design system.
- Authentication or user management.
- Real Shopify, Stripe, warehouse, carrier, or ERP integrations.
- A complete commerce backend.
- Complex deployment or CI/CD infrastructure.
- Broad analytics or reporting.
- Real customer data.

## Repository Layout

```text
src/
  server.ts              MCP server entry, HTTP + Streamable HTTP endpoint
  domain/types.ts        Domain types (orders, actions, escalations, audit)
  data/store.ts          In-memory store + audit helpers
  data/seed.ts           Synthetic seed data (ORD-1007...ORD-1011)
  services/investigation.ts  Diagnosis + action boundary logic
  services/escalation.ts     Escalation validation, audit write
tests/
  operations-workflow.test.ts  Unit tests for workflow + safety rules
  mcp-e2e.test.ts              End-to-end tests over HTTP
opencode.json            Sample client config (remote MCP)
Dockerfile, render.yaml  Deployment
```

## Local Development

```bash
npm install
npm run dev
```

The local MCP endpoint is:

```text
http://127.0.0.1:3001/mcp
```

## Remotely Hosted Endpoint

The server is deployed and reachable by any MCP client over Streamable HTTP:

```text
https://ops-mcp-qn8w.onrender.com/mcp
```

No API key or auth is required (synthetic data only). Connect from any MCP client:

- **MCP Inspector**: open the inspector, choose "Connect", enter the URL, then "Connect".
- **opencode** (`opencode.json`):
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
- **Claude Desktop / Claude Code** (`claude_desktop_config.json`):
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
- **Gemini CLI**: `gemini mcp add ops-mcp https://ops-mcp-qn8w.onrender.com/mcp --transport http`
- **Cursor / Windsurf / VS Code**: add a new MCP server, choose HTTP/remote, and paste the URL.

Once connected, the same prompts work in any client:

```text
Why hasn't order ORD-1007 shipped?
Is it safe to retry fulfillment?
Create a human-review escalation for it.
Show the audit log.
```

`create_escalation` requires a `createdBy` operator email — that email is recorded in the audit log as the human authorizing the escalation, keeping the MCP as evidence-gathering and recommendation only. A remote tester just supplies any synthetic operator email, for example `ops@example.test`.

## Verification

Focused verification covers the behavior that matters to the workflow:

- Investigating the main stuck fulfillment order.
- Suggesting human-review escalation when fulfillment is blocked.
- Confirming direct fulfillment retry and refunds are human-review-only, not MCP-executable.
- Writing an audit log entry for created escalations.
- Rejecting invalid or unsafe escalations (unknown orders, refunded orders, duplicate open escalations).
- Returning clear errors for unknown orders.

Actual results: `npm run build` passes, and `npm test` runs 11 tests (5 unit + 6 end-to-end over HTTP) that all pass. The deployed HTTPS endpoint was verified with a 35-check protocol sweep and a fresh-session AI client test.

```bash
npm test
npm run build
```

## Status

Complete. The MCP server implements the delayed-or-blocked-order workflow with search, investigation, action suggestion, human-review escalation, and audit logging, all backed by synthetic data. It is deployed at `https://ops-mcp-qn8w.onrender.com/mcp`, verified by 11 passing tests, a 35-check protocol sweep against the hosted endpoint, and a zero-context AI-client session. Submission docs: this README, `AI_WORKLOG.md`, and `DEMO_SCRIPT.md`.
