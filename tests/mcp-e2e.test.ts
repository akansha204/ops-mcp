import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_PORT = 3123;
const BASE = `http://127.0.0.1:${TEST_PORT}/mcp`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let child: ChildProcess;

async function rpc(payload: unknown): Promise<any> {
  const response = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  const dataLines = raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));

  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await rpc({
    jsonrpc: '2.0',
    id: 'call',
    method: 'tools/call',
    params: { name, arguments: args },
  });

  expect(res.error).toBeUndefined();

  const result = res.result;
  const text = result.content
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n');

  return {
    text,
    structured: result.structuredContent,
    isError: result.isError ?? false,
  };
}

beforeAll(async () => {
  child = spawn(
    process.execPath,
    [path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/server.ts'],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(TEST_PORT), HOST: '127.0.0.1' },
      stdio: 'pipe',
    },
  );

  let listening = false;
  for (let i = 0; i < 50; i += 1) {
    if (child.stdout && child.stdout.readable) {
      const chunk = child.stdout.read();
      if (chunk && chunk.toString().includes('listening')) {
        listening = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!listening) {
    throw new Error(`MCP test server did not start on port ${TEST_PORT}`);
  }

  await rpc({
    jsonrpc: '2.0',
    id: 'init',
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '0.0.0' },
    },
  });
}, 20_000);

afterAll(async () => {
  if (child) {
    child.kill();
  }
});

describe('hosted MCP server end-to-end workflow', () => {
  it('exposes the expected MCP tools', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 'tools', method: 'tools/list', params: {} });
    const names = res.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toEqual([
      'search_orders',
      'investigate_order',
      'suggest_order_actions',
      'create_escalation',
      'get_audit_log',
    ]);
  });

  it('diagnoses the stuck fulfillment demo order without mutation', async () => {
    const out = await callTool('investigate_order', { orderId: 'ORD-1007' });
    const investigation = out.structured.investigation;

    expect(investigation.paymentStatus).toBe('captured');
    expect(investigation.inventoryStatuses).toContain('BAG-001:reserved');
    expect(investigation.fulfillmentStatus).toBe('failed');
    expect(investigation.diagnosis.blocker).toBe('warehouse_job_timeout');
    expect(investigation.diagnosis.recommendedNextAction).toBe(
      'create_human_review_escalation',
    );
  });

  it('surfaces fulfillment retry as human-review-only', async () => {
    const out = await callTool('suggest_order_actions', { orderId: 'ORD-1007' });
    const actions = new Map(
      out.structured.actions.map((a: { action: string }) => [a.action, a]),
    );

    expect(actions.get('retry_fulfillment')).toMatchObject({
      allowed: false,
      requiresApproval: true,
      boundary: 'human_review_only',
    });
    expect(actions.get('create_human_review_escalation').boundary).toBe('mcp_allowed');
    expect(actions.get('reroute_order').boundary).toBe('blocked');
    expect(actions.get('cancel_order').boundary).toBe('blocked');
    expect(actions.get('modify_shipping_address').boundary).toBe('blocked');
    expect(actions.get('issue_refund').boundary).toBe('human_review_only');
  });

  it('creates and audits an escalation without mutating order state', async () => {
    const before = await callTool('investigate_order', { orderId: 'ORD-1007' });

    const out = await callTool('create_escalation', {
      orderId: 'ORD-1007',
      createdBy: 'ops@example.test',
      reason: 'Customer escalation after fulfillment job timeout.',
    });

    expect(out.structured.ok).toBe(true);
    expect(out.structured.escalation).toMatchObject({
      orderId: 'ORD-1007',
      queue: 'fulfillment_review',
      status: 'open',
      blocker: 'warehouse_job_timeout',
    });
    expect(out.structured.unchangedState).toEqual({
      orderStatus: 'blocked',
      fulfillmentStatus: 'failed',
    });

    const after = await callTool('investigate_order', { orderId: 'ORD-1007' });
    expect(after.structured.investigation.openEscalationCount).toBe(
      before.structured.investigation.openEscalationCount + 1,
    );
    expect(after.structured.investigation.orderStatus).toBe('blocked');
    expect(after.structured.investigation.fulfillmentStatus).toBe('failed');

    const audit = await callTool('get_audit_log', { orderId: 'ORD-1007' });
    const actions = audit.structured.auditLog.map((e: { action: string }) => e.action);
    expect(actions).toContain('create_human_review_escalation');
  });

  it('rejects duplicate, refunded, and unknown-order escalations', async () => {
    const duplicate = await callTool('create_escalation', {
      orderId: 'ORD-1007',
      createdBy: 'ops@example.test',
      reason: 'Duplicate escalation attempt for review.',
    });
    expect(duplicate.structured.ok).toBe(false);
    expect(duplicate.structured.message).toContain('already exists');

    const refunded = await callTool('create_escalation', {
      orderId: 'ORD-1011',
      createdBy: 'ops@example.test',
      reason: 'Attempt to escalate closed refunded order.',
    });
    expect(refunded.structured.ok).toBe(false);
    expect(refunded.structured.message).toContain('Refunded');

    const unknown = await callTool('create_escalation', {
      orderId: 'ORD-NOPE',
      createdBy: 'ops@example.test',
      reason: 'Unknown order escalation attempt.',
    });
    expect(unknown.structured.ok).toBe(false);
    expect(unknown.structured.message).toContain('No synthetic order found');
  });

  it('searches orders by status and customer email', async () => {
    const byStatus = await callTool('search_orders', { status: 'blocked' });
    expect(
      byStatus.structured.orders.map((o: { id: string }) => o.id).sort(),
    ).toEqual(['ORD-1007', 'ORD-1009']);

    const byEmail = await callTool('search_orders', {
      customerEmail: 'maya.chen@example.test',
    });
    expect(byEmail.structured.orders).toHaveLength(1);
    expect(byEmail.structured.orders[0].id).toBe('ORD-1007');
  });
});
