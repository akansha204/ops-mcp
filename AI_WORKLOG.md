# AI Worklog

This document records how AI tools were used across the assignment, which models were selected and why, what the human owner and AI each did, the important prompts and context supplied, and how AI-generated work was verified.

## AI Tools And Specific Models Used

- **opencode** (AI coding agent CLI, v1.18.11) running the model **opencode/big-pickle** as the primary implementation agent. Used for product scoping, planning, TypeScript implementation, tests, debugging, documentation, and final review.
- **Gemini CLI** (v0.53.1, free tier, `gemini-3.5-flash`) as a secondary, independent AI MCP consumer used to verify that the hosted server works from an external AI client.
- **MCP Inspector** and **curl** for deterministic, model-independent protocol verification (initialize, tools/list, tools/call, error paths).
- **Shell tooling**: TypeScript compiler (`tsc`), Vitest, `tsx` (test runner), Docker, and Render for build, test, and deployment verification.

## Model Selection Rationale

- **opencode / big-pickle for implementation**: selected because it is a coding agent with a tight read-edit-bash loop, full repository context, and the ability to run the build and test suite after every change. This maximized iteration speed while keeping the human owner in control of every decision.
- **Gemini CLI for consumer verification**: selected as a free, real-world third-party AI client to prove the hosted MCP endpoint was usable by a client the author did not control. It surfaced real integration issues (registration scope, transport type, free-tier rate limits) that would not appear in a hand-written test.
- **MCP Inspector and curl for protocol verification**: selected because they are deterministic and free of model quota. They are the source of truth for protocol behavior and are immune to model flakiness or rate limiting, which made them the most reliable verification path.

## How AI Was Used To Plan And Break Down The Work

- The AI interpreted the open-ended brief, proposed several candidate commerce-operations workflows, and compared them on scope, effort, and how much they exercised the MCP. The delayed-or-blocked order investigation workflow was chosen because it touches order, payment, inventory, fulfillment, events, and audit concepts while remaining small enough to implement and verify in the timeframe.
- The work was broken into seven phases (scope -> architecture -> data -> tools -> verification -> deployment -> docs), each with an explicit "next move" handoff so the human owner always knew the immediate action.
- AI generated the initial scaffolding, data model, service functions, tool registrations, and test scaffolding; the human owner reviewed and adjusted each phase.

## How Responsibilities Were Divided Between Human And AI

- **Human owner**: final product judgment, choosing and confirming scope with the assignment giver, approving the remediation boundary, owning client communication, deployment account access, and recording the demo video.
- **AI**: implementation support, documentation drafts, test writing, code review, running verification, explaining tradeoffs, and surfacing inconsistencies for the human to decide on.

## Important Prompts, Instructions, And Context Supplied

- The full assignment brief, pasted verbatim, including the submission requirements and evaluation emphasis.
- The assignment giver's clarification that the MCP must not retry or requeue fulfillment, reroute or cancel orders, modify addresses, or mutate post-dispatch state; it may gather evidence and create validated human-review escalations.
- Workflow-driving prompts for the live client tests, for example:
  - "Why hasn't order ORD-1007 shipped?"
  - "Is it safe to retry fulfillment?"
  - "Create a human-review escalation for ORD-1007."
  - "Show the audit log."
- Read-only constraints for verification runs: "Read-only: do not create any escalations."
- A zero-context verification instruction to a fresh opencode session with no project knowledge, to prove the hosted server is self-describing: list the MCP tools, then investigate ORD-1007.
- The standing rule that the MCP remains human-in-the-loop: escalations must record the authorizing operator's email.

## AI Suggestions That Were Corrected, Rejected, Or Substantially Changed

- **Rejected: making `create_escalation.createdBy` optional with a default.** To reduce friction for remote testers, the AI proposed auto-filling a default operator email (`ops@example.test`) when the caller omits one, and it was briefly implemented. The human owner rejected and reverted this: the email is recorded in the audit log as the human authorizing the escalation. Auto-filling it would let the MCP appear to act on behalf of a person who never decided anything, breaking the human-in-the-loop boundary agreed with the assignment giver. The field remains required.
- **Corrected: `send_customer_update` advertised but not implemented.** An early version of the action suggestion logic listed `send_customer_update` as "allowed" even though no matching tool existed, which would make an AI client try to call a non-existent tool. Caught in review; the action was removed so the MCP only advertises executable actions.
- **Corrected: Gemini CLI MCP transport.** The first `gemini mcp add` attempt failed because the CLI defaults to `stdio` transport. It was corrected with `--transport http`, and the server is registered at project scope.
- **Corrected: Render build failure.** `error TS2688: Cannot find type definition file for 'node'` occurred because Render builds with `NODE_ENV=production`, which skips devDependencies. The build command was changed to `npm ci --include=dev && npm run build`, and the fix was verified locally under `NODE_ENV=production`.

## How AI-Generated Work Was Verified

- TypeScript build (`npm run build`) run after every change.
- 11 automated tests, all passing: 5 unit tests for the workflow and safety rules, and 6 end-to-end tests that boot the server over HTTP and drive the MCP protocol (2 files).
- A 35-check manual protocol sweep against the local HTTP server covering the full workflow, safety boundaries, duplicate/refunded/unknown-order rejections, other issue types, and search.
- The same sweep re-run against the deployed HTTPS endpoint.
- The Docker image was built and booted locally, and the MCP initialize handshake was verified inside the container.
- A brand-new, zero-context opencode session was launched against the hosted server to confirm tools auto-discover and the workflow completes without any prior project context.
- A human reviewer read the final README, demo script, and worklog.

## Remaining Risks And Unfinished Work

- **In-memory state**: escalations and audit entries reset on restart or redeploy. This is intentional for the demo, but production would require a database, persistence, and idempotency keys for concurrent escalation attempts.
- **No authentication**: acceptable because the server exposes only synthetic data, but auth and tenant isolation are required before any production use.
- **Free-tier hosting cold starts**: the hosted instance sleeps after idle and can take 30-60 seconds to wake.
- **Gemini free-tier rate limits**: can interrupt a live AI-client demo; the MCP Inspector and curl paths are always available as a fallback.
- **`create_escalation` ID generation** uses `Date.now()`, which could collide under concurrent calls at high volume; fine at this scale.
- **Out of scope by design**: customer-facing messaging, refund review, and routing escalations into a real ticketing or warehouse queue are documented as next steps rather than implemented.
