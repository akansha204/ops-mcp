import type {
  AuditLogEntry,
  OrderAction,
  OrderSnapshot,
} from '../domain/types.js';

export interface Diagnosis {
  summary: string;
  blocker: string | null;
  severity: 'none' | 'low' | 'medium' | 'high';
  evidence: string[];
  recommendedNextAction: OrderAction | 'none';
}

export interface SuggestedAction {
  action: OrderAction;
  allowed: boolean;
  requiresApproval: boolean;
  boundary: 'mcp_allowed' | 'human_review_only' | 'blocked';
  reason: string;
}

export interface OrderInvestigation {
  orderId: string;
  customerEmail: string;
  orderStatus: string;
  issueType: string;
  paymentStatus: string | null;
  inventoryStatuses: string[];
  fulfillmentStatus: string | null;
  diagnosis: Diagnosis;
  suggestedActions: SuggestedAction[];
  timeline: Array<{
    type: string;
    message: string;
    createdAt: string;
  }>;
  auditLog: AuditLogEntry[];
}

export function investigateSnapshot(snapshot: OrderSnapshot): OrderInvestigation {
  const diagnosis = diagnose(snapshot);

  return {
    orderId: snapshot.order.id,
    customerEmail: snapshot.order.customer.email,
    orderStatus: snapshot.order.status,
    issueType: snapshot.order.issueType,
    paymentStatus: snapshot.payment?.status ?? null,
    inventoryStatuses: snapshot.inventoryReservations.map(
      (reservation) => `${reservation.sku}:${reservation.status}`,
    ),
    fulfillmentStatus: snapshot.fulfillment?.status ?? null,
    diagnosis,
    suggestedActions: suggestActions(snapshot),
    timeline: snapshot.events.map((event) => ({
      type: event.type,
      message: event.message,
      createdAt: event.createdAt,
    })),
    auditLog: snapshot.auditLog,
  };
}

export function suggestActions(snapshot: OrderSnapshot): SuggestedAction[] {
  const actions: SuggestedAction[] = [
    humanReviewEscalationAction(snapshot),
    customerUpdateAction(snapshot),
    releaseInventoryAction(snapshot),
    retryFulfillmentAction(snapshot),
    rerouteOrderAction(),
    cancelOrderAction(),
    modifyAddressAction(),
    refundAction(snapshot),
  ];

  return actions;
}

export function formatInvestigation(investigation: OrderInvestigation): string {
  const suggested = investigation.suggestedActions
    .filter((action) => action.allowed || action.requiresApproval)
    .map((action) => {
      const approval = action.requiresApproval ? 'human review only' : 'allowed';
      return `- ${action.action}: ${approval}. ${action.reason}`;
    })
    .join('\n');

  const evidence = investigation.diagnosis.evidence
    .map((item) => `- ${item}`)
    .join('\n');

  return [
    `Order ${investigation.orderId} diagnosis: ${investigation.diagnosis.summary}`,
    `Blocker: ${investigation.diagnosis.blocker ?? 'none detected'}`,
    `Recommended next action: ${investigation.diagnosis.recommendedNextAction}`,
    '',
    'Evidence:',
    evidence || '- No evidence available.',
    '',
    'Suggested actions:',
    suggested || '- No operational action suggested.',
  ].join('\n');
}

function diagnose(snapshot: OrderSnapshot): Diagnosis {
  const paymentStatus = snapshot.payment?.status;
  const fulfillmentStatus = snapshot.fulfillment?.status;
  const hasReservedInventory = snapshot.inventoryReservations.some(
    (reservation) => reservation.status === 'reserved',
  );
  const hasInventoryShortage = snapshot.inventoryReservations.some(
    (reservation) => reservation.status === 'insufficient_stock',
  );

  if (paymentStatus === 'failed') {
    return {
      summary: 'Order is blocked because payment failed.',
      blocker: 'payment_failed',
      severity: 'medium',
      evidence: [
        `Payment ${snapshot.payment?.id} is failed.`,
        snapshot.payment?.failureReason
          ? `Payment failure reason: ${snapshot.payment.failureReason}.`
          : 'No payment failure reason was provided.',
      ],
      recommendedNextAction: 'create_human_review_escalation',
    };
  }

  if (hasInventoryShortage) {
    return {
      summary: 'Order is blocked because requested inventory is not fully available.',
      blocker: 'inventory_shortage',
      severity: 'high',
      evidence: snapshot.inventoryReservations.map(
        (reservation) =>
          `${reservation.sku} requested ${reservation.requestedQuantity}, reserved ${reservation.reservedQuantity}, status ${reservation.status}.`,
      ),
      recommendedNextAction: 'create_human_review_escalation',
    };
  }

  if (
    paymentStatus === 'captured' &&
    hasReservedInventory &&
    fulfillmentStatus === 'failed'
  ) {
    return {
      summary:
        'Order is paid and inventory is reserved, but fulfillment failed before shipment.',
      blocker: snapshot.fulfillment?.failureReason ?? 'fulfillment_failed',
      severity: 'high',
      evidence: [
        `Payment ${snapshot.payment?.id} is captured.`,
        'Inventory reservation is available.',
        `Fulfillment ${snapshot.fulfillment?.id} is failed.`,
        snapshot.fulfillment?.failureReason
          ? `Fulfillment failure reason: ${snapshot.fulfillment.failureReason}.`
          : 'No fulfillment failure reason was provided.',
      ],
      recommendedNextAction: 'create_human_review_escalation',
    };
  }

  if (snapshot.order.issueType === 'carrier_delay') {
    return {
      summary: 'Order has shipped, but carrier progress appears delayed.',
      blocker: 'carrier_delay',
      severity: 'medium',
      evidence: [
        `Fulfillment status is ${fulfillmentStatus ?? 'unknown'}.`,
        snapshot.fulfillment?.trackingNumber
          ? `Tracking number is ${snapshot.fulfillment.trackingNumber}.`
          : 'No tracking number is available.',
      ],
      recommendedNextAction: 'create_human_review_escalation',
    };
  }

  if (snapshot.order.status === 'refunded' || paymentStatus === 'refunded') {
    return {
      summary: 'Order has already been refunded.',
      blocker: null,
      severity: 'none',
      evidence: ['Order or payment status indicates refund is complete.'],
      recommendedNextAction: 'none',
    };
  }

  return {
    summary: 'No active operational blocker was detected from synthetic data.',
    blocker: null,
    severity: 'low',
    evidence: [
      `Order status is ${snapshot.order.status}.`,
      `Payment status is ${paymentStatus ?? 'unknown'}.`,
      `Fulfillment status is ${fulfillmentStatus ?? 'unknown'}.`,
    ],
    recommendedNextAction: 'none',
  };
}

function humanReviewEscalationAction(snapshot: OrderSnapshot): SuggestedAction {
  const paymentCaptured = snapshot.payment?.status === 'captured';
  const inventoryReserved = snapshot.inventoryReservations.some(
    (reservation) => reservation.status === 'reserved',
  );
  const fulfillmentFailed = snapshot.fulfillment?.status === 'failed';
  const needsReview =
    snapshot.order.issueType === 'stuck_fulfillment' ||
    snapshot.order.issueType === 'inventory_shortage' ||
    snapshot.order.issueType === 'carrier_delay' ||
    snapshot.order.issueType === 'payment_exception';

  return {
    action: 'create_human_review_escalation',
    allowed: needsReview,
    requiresApproval: false,
    boundary: 'mcp_allowed',
    reason:
      paymentCaptured && inventoryReserved && fulfillmentFailed
        ? 'MCP can create a human-review escalation with payment, inventory, and fulfillment evidence attached.'
        : 'MCP can create a human-review escalation when the order has an operational blocker.',
  };
}

function retryFulfillmentAction(snapshot: OrderSnapshot): SuggestedAction {
  const relevant = snapshot.fulfillment?.status === 'failed';

  return {
    action: 'retry_fulfillment',
    allowed: false,
    requiresApproval: relevant,
    boundary: relevant ? 'human_review_only' : 'blocked',
    reason: relevant
      ? 'MCP must not retry or requeue fulfillment; it can only escalate for human review.'
      : 'Retry is not relevant unless fulfillment has failed.',
  };
}

function customerUpdateAction(snapshot: OrderSnapshot): SuggestedAction {
  const allowed = snapshot.order.status !== 'delivered';

  return {
    action: 'send_customer_update',
    allowed,
    requiresApproval: false,
    boundary: allowed ? 'mcp_allowed' : 'blocked',
    reason: allowed
      ? 'Customer-facing status update is safe and does not mutate commerce state.'
      : 'Delivered orders do not need a delay update.',
  };
}

function releaseInventoryAction(snapshot: OrderSnapshot): SuggestedAction {
  const hasReservation = snapshot.inventoryReservations.some(
    (reservation) => reservation.status === 'reserved',
  );
  const allowed =
    hasReservation &&
    (snapshot.payment?.status === 'failed' || snapshot.order.status === 'cancelled');

  return {
    action: 'release_inventory_reservation',
    allowed: false,
    requiresApproval: allowed,
    boundary: allowed ? 'human_review_only' : 'blocked',
    reason: allowed
      ? 'MCP must not release inventory; it can include this as a human-review recommendation.'
      : 'Inventory release is only relevant when payment failed or the order is cancelled.',
  };
}

function rerouteOrderAction(): SuggestedAction {
  return {
    action: 'reroute_order',
    allowed: false,
    requiresApproval: false,
    boundary: 'blocked',
    reason: 'MCP must not reroute orders in this demo scope.',
  };
}

function cancelOrderAction(): SuggestedAction {
  return {
    action: 'cancel_order',
    allowed: false,
    requiresApproval: false,
    boundary: 'blocked',
    reason: 'MCP must not cancel orders in this demo scope.',
  };
}

function modifyAddressAction(): SuggestedAction {
  return {
    action: 'modify_shipping_address',
    allowed: false,
    requiresApproval: false,
    boundary: 'blocked',
    reason: 'MCP must not modify shipping addresses in this demo scope.',
  };
}

function refundAction(snapshot: OrderSnapshot): SuggestedAction {
  const capturedPayment = snapshot.payment?.status === 'captured';
  const alreadyRefunded =
    snapshot.payment?.status === 'refunded' || snapshot.order.status === 'refunded';

  return {
    action: 'issue_refund',
    allowed: false,
    requiresApproval: capturedPayment && !alreadyRefunded,
    boundary: capturedPayment && !alreadyRefunded ? 'human_review_only' : 'blocked',
    reason: alreadyRefunded
      ? 'Refund is blocked because the order is already refunded.'
      : 'Refunds are high-risk and outside MCP execution scope; they require human review.',
  };
}
