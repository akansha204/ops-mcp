# Demo Script

Target length: 4 to 5 minutes. Recorded with Loom or OBS. Show the deployed solution end to end: the hosted MCP, how an AI client uses it, and the key product and technical decisions.

Recommended on-screen client: **opencode** or **MCP Inspector**, connected to the hosted URL. MCP Inspector is the safest fallback because it uses no AI-model quota. If using an AI client and a rate limit interrupts you, switch to MCP Inspector and continue the same steps.

Hosted URL used throughout: `https://ops-mcp-qn8w.onrender.com/mcp`

> Timing note: the hosted instance sleeps after ~15 minutes idle. Warm it up (open the health URL) before recording so you do not eat 30-60 seconds of cold start on camera.

---

## Scene 1 — Problem and user (0:00 - 0:40)

On screen: the repo/README, or a slide with the product name.

Say: "This is an AI operations copilot for ecommerce teams. The user is an operations associate who handles delayed or blocked orders. Today, questions like 'why hasn't this paid order shipped?' need an engineer to trace payment, inventory, and fulfillment systems. This product makes the team independent: an AI assistant answers those questions through a hosted MCP server."

State the scope in one breath: "No frontend, no auth, no real commerce integrations, synthetic data only. The MCP server is the product — the workflow cannot run without it."

## Scene 2 — Architecture (0:40 - 1:20)

On screen: the README architecture diagram.

Say: "The AI assistant connects over Streamable HTTP to a TypeScript MCP server hosted on Render. The server exposes five tools: search, investigate, suggest actions, create escalation, and audit log. Four are read-only. Only one writes — creating a human-review escalation — and that write never mutates the order or fulfillment state."

## Scene 3 — Main workflow: investigate (1:20 - 2:30)

On screen: the client connected to the hosted URL, tools listed.

Say: "Here's a brand-new AI session with no project context, connected to the hosted server." (If using opencode, mention the zero-context session; if MCP Inspector, point at the tool list.)

Prompt:

```text
Why hasn't order ORD-1007 shipped?
```

Point at the tool call that fires (`investigate_order`). Say: "The server inspects order, payment, inventory, fulfillment, events, and audit history, and returns a structured diagnosis: payment captured, inventory reserved, fulfillment failed with a warehouse job timeout. Recommended action: human-review escalation."

## Scene 4 — Safety boundary and escalation (2:30 - 3:40)

Prompt:

```text
Is it safe to retry fulfillment?
```

Point at the response: "Retry fulfillment is human-review-only, not something the MCP executes. The same for refunds. The MCP can only gather evidence and escalate for human review."

Prompt:

```text
Create a human-review escalation for ORD-1007.
```

Say: "The tool asks for the authorizing operator's email. I'll use ops@example.test. This is deliberate: the email is recorded in the audit log as the human who authorized the escalation. The MCP never invents an actor."

Point at the response: "Escalation created, queued to fulfillment review, with the evidence summary attached. And critically, the response includes an unchanged-state check: order status stays blocked, fulfillment status stays failed. Nothing was mutated."

Then show the audit log:

```text
Show the audit log.
```

Point at both entries — the original customer escalation and the new MCP-created escalation.

## Scene 5 — Safety and a rejection (3:40 - 4:10)

Say: "Here's the safety behavior that matters." Re-run the create prompt, or show it as a second client call:

```text
Create a human-review escalation for ORD-1007.
```

Point at the rejection: "An open escalation already exists, so the server rejects the duplicate. The MCP validates preconditions before it writes anything, and unknown or refunded orders are rejected with clear errors."

## Scene 6 — Verification and decisions (4:10 - 4:40)

On screen: test output (11 passing) and the fresh-session test.

Say: "The behavior was verified three ways: 11 automated tests — unit tests for the safety rules and end-to-end tests that boot the server over HTTP — plus a 35-check protocol sweep against the deployed URL, and this zero-context session you're watching, which proves the hosted server is self-describing to any AI client."

## Scene 7 — Tradeoffs and next steps (4:40 - 5:00)

Say: "The main tradeoff is in-memory synthetic data: escalations reset on redeploy, which is fine for a demo and lets reviewers repeat the workflow cleanly. Production would add a database, idempotency, and auth. Next steps are connecting real read-only commerce systems, then routing escalations into an existing ticketing or warehouse review queue."

Close: "The hosted URL, repository, and this demo are all in the submission. Thank you."

---

## Recording checklist

- [ ] Warm up the hosted instance (open the health URL) before recording.
- [ ] Fresh client session connected to `https://ops-mcp-qn8w.onrender.com/mcp`.
- [ ] Keep prompts exactly as written above; tool calls appear automatically.
- [ ] If an open escalation already exists from a prior test, do a Render manual redeploy to reset state, or use order ORD-1008 (payment review) for the escalation scene.
- [ ] Keep total runtime between 4:00 and 5:00.
