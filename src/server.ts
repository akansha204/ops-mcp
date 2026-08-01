import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { commerceStore } from './data/store.js';
import type { OrderSearchFilters } from './data/store.js';
import { createHumanReviewEscalation } from './services/escalation.js';
import {
  formatInvestigation,
  investigateSnapshot,
  suggestActions,
} from './services/investigation.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

const server = new McpServer({
  name: 'Commerce Operations MCP',
  version: '1.0.0',
});

const orderStatusSchema = z.enum([
  'pending_payment',
  'paid',
  'blocked',
  'ready_for_fulfillment',
  'fulfillment_in_progress',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);

const issueTypeSchema = z.enum([
  'stuck_fulfillment',
  'payment_exception',
  'inventory_shortage',
  'carrier_delay',
  'refunded',
  'none',
]);

const escalationQueueSchema = z.enum([
  'fulfillment_review',
  'inventory_review',
  'payment_review',
  'carrier_review',
]);

server.registerTool(
  'search_orders',
  {
    title: 'Search Orders',
    description:
      'Find synthetic commerce orders by status, issue type, or customer email before investigating an escalation.',
    inputSchema: z.object({
      status: orderStatusSchema.optional(),
      issueType: issueTypeSchema.optional(),
      customerEmail: z.string().email().optional(),
    }),
  },
  async ({ status, issueType, customerEmail }) => {
    const filters: OrderSearchFilters = {};

    if (status) {
      filters.status = status;
    }

    if (issueType) {
      filters.issueType = issueType;
    }

    if (customerEmail) {
      filters.customerEmail = customerEmail;
    }

    const orders = commerceStore.searchOrders(filters);

    const output = {
      count: orders.length,
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        issueType: order.issueType,
        customerEmail: order.customer.email,
        totalCents: order.totalCents,
        updatedAt: order.updatedAt,
      })),
    };

    return {
      content: [
        {
          type: 'text',
          text:
            orders.length === 0
              ? 'No matching synthetic orders found.'
              : `Found ${orders.length} matching synthetic order(s).`,
        },
      ],
      structuredContent: output,
    };
  },
);

server.registerTool(
  'investigate_order',
  {
    title: 'Investigate Order',
    description:
      'Investigate a synthetic ecommerce order across order, payment, inventory, fulfillment, event, and audit data. Use this as the primary tool for delayed or blocked order escalations.',
    inputSchema: z.object({
      orderId: z
        .string()
        .min(1)
        .describe('Synthetic order ID, for example ORD-1007.'),
    }),
  },
  async ({ orderId }) => {
    const snapshot = commerceStore.getOrderSnapshot(orderId);

    if (!snapshot) {
      const output = {
        orderId,
        found: false,
        message: `No synthetic order found for ${orderId}.`,
      };

      return {
        content: [{ type: 'text', text: output.message }],
        structuredContent: output,
        isError: true,
      };
    }

    const investigation = investigateSnapshot(snapshot);

    return {
      content: [{ type: 'text', text: formatInvestigation(investigation) }],
      structuredContent: {
        found: true,
        investigation,
      },
    };
  },
);

server.registerTool(
  'suggest_order_actions',
  {
    title: 'Suggest Order Actions',
    description:
      'Return allowed, blocked, and approval-required operational actions for a synthetic order. This is read-only and does not execute the action.',
    inputSchema: z.object({
      orderId: z
        .string()
        .min(1)
        .describe('Synthetic order ID, for example ORD-1007.'),
    }),
  },
  async ({ orderId }) => {
    const snapshot = commerceStore.getOrderSnapshot(orderId);

    if (!snapshot) {
      const output = {
        orderId,
        found: false,
        message: `No synthetic order found for ${orderId}.`,
      };

      return {
        content: [{ type: 'text', text: output.message }],
        structuredContent: output,
        isError: true,
      };
    }

    const actions = suggestActions(snapshot);
    const visibleActions = actions.filter(
      (action) => action.allowed || action.requiresApproval,
    );

    return {
      content: [
        {
          type: 'text',
          text:
            visibleActions.length === 0
              ? `No safe operational actions are currently suggested for ${orderId}.`
              : visibleActions
                  .map((action) => {
                    const state = action.requiresApproval
                      ? 'requires approval'
                      : 'allowed';
                    return `${action.action}: ${state}. ${action.reason}`;
                  })
                  .join('\n'),
        },
      ],
      structuredContent: {
        orderId,
        found: true,
        actions,
      },
    };
  },
);

server.registerTool(
  'create_escalation',
  {
    title: 'Create Human-Review Escalation',
    description:
      'Create and audit a human-review escalation for a delayed or blocked synthetic order. This tool does not retry fulfillment, requeue work, reroute, cancel, edit addresses, issue refunds, or mutate post-dispatch state.',
    inputSchema: z.object({
      orderId: z
        .string()
        .min(1)
        .describe('Synthetic order ID, for example ORD-1007.'),
      createdBy: z
        .string()
        .email()
        .describe('Synthetic operator email creating the escalation.'),
      reason: z
        .string()
        .min(10)
        .describe('Why this escalation is being created.'),
      requestedQueue: escalationQueueSchema.optional(),
    }),
  },
  async ({ orderId, createdBy, reason, requestedQueue }) => {
    const result = createHumanReviewEscalation(commerceStore, {
      orderId,
      createdBy,
      reason,
      ...(requestedQueue ? { requestedQueue } : {}),
    });

    if (!result.ok) {
      return {
        content: [{ type: 'text', text: result.message }],
        structuredContent: result,
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: [
            `Created escalation ${result.escalation.id} for ${orderId}.`,
            `Queue: ${result.escalation.queue}.`,
            `No order or fulfillment state was mutated.`,
            `Order status remains ${result.unchangedState.orderStatus}; fulfillment status remains ${result.unchangedState.fulfillmentStatus ?? 'unknown'}.`,
          ].join(' '),
        },
      ],
      structuredContent: result,
    };
  },
);

server.registerTool(
  'get_audit_log',
  {
    title: 'Get Audit Log',
    description:
      'Read the synthetic operational audit log for an order to see prior actions and outcomes.',
    inputSchema: z.object({
      orderId: z
        .string()
        .min(1)
        .describe('Synthetic order ID, for example ORD-1007.'),
    }),
  },
  async ({ orderId }) => {
    const order = commerceStore.getOrder(orderId);

    if (!order) {
      const output = {
        orderId,
        found: false,
        message: `No synthetic order found for ${orderId}.`,
      };

      return {
        content: [{ type: 'text', text: output.message }],
        structuredContent: output,
        isError: true,
      };
    }

    const auditLog = commerceStore.getAuditLog(orderId);

    return {
      content: [
        {
          type: 'text',
          text:
            auditLog.length === 0
              ? `No audit entries found for ${orderId}.`
              : auditLog
                  .map(
                    (entry) =>
                      `${entry.createdAt} ${entry.action} ${entry.result}: ${entry.reason}`,
                  )
                  .join('\n'),
        },
      ],
      structuredContent: {
        orderId,
        found: true,
        auditLog,
      },
    };
  },
);

const transport = new NodeStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

await server.connect(transport);

const app = createMcpExpressApp({ host: HOST });

app.all('/mcp', async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`MCP server listening at http://${HOST}:${PORT}/mcp`);
});

process.on('SIGINT', async () => {
  httpServer.close();
  await transport.close();
  await server.close();
  process.exit(0);
});
