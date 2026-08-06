import type { CommerceStore } from '../data/store.js';
import { DuplicateOpenEscalationError } from '../data/persistence.js';
import type {
  AuditLogEntry,
  Escalation,
  EscalationQueue,
  OrderSnapshot,
} from '../domain/types.js';
import { investigateSnapshot } from './investigation.js';

export interface CreateEscalationInput {
  orderId: string;
  createdBy: string;
  reason: string;
  requestedQueue?: EscalationQueue;
}

export type CreateEscalationResult =
  | {
      ok: true;
      escalation: Escalation;
      auditLogEntry: AuditLogEntry;
      unchangedState: {
        orderStatus: string;
        fulfillmentStatus: string | null;
      };
    }
  | {
      ok: false;
      message: string;
    };

export async function createHumanReviewEscalation(
  store: CommerceStore,
  input: CreateEscalationInput,
): Promise<CreateEscalationResult> {
  const snapshot = await store.getOrderSnapshot(input.orderId);

  if (!snapshot) {
    return {
      ok: false,
      message: `No synthetic order found for ${input.orderId}.`,
    };
  }

  const validation = validateEscalation(snapshot);

  if (!validation.ok) {
    return validation;
  }

  const investigation = investigateSnapshot(snapshot);
  const createdAt = new Date().toISOString();
  const queue = input.requestedQueue ?? inferQueue(snapshot);
  const escalation: Escalation = {
    id: `ESC-${Date.now()}`,
    orderId: snapshot.order.id,
    queue,
    status: 'open',
    blocker: investigation.diagnosis.blocker ?? 'unknown_blocker',
    evidenceSummary: investigation.diagnosis.evidence,
    recommendedHumanAction: recommendationForQueue(queue),
    createdBy: input.createdBy,
    createdAt,
  };

  const auditLogEntry: AuditLogEntry = {
    id: `AUD-${Date.now()}`,
    orderId: snapshot.order.id,
    action: 'create_human_review_escalation',
    actor: input.createdBy,
    reason: input.reason,
    result: 'applied',
    createdAt,
    metadata: {
      escalationId: escalation.id,
      queue,
      blocker: escalation.blocker,
    },
  };

  try {
    await store.createEscalationWithAudit(escalation, auditLogEntry);
  } catch (error) {
    if (error instanceof DuplicateOpenEscalationError) {
      return {
        ok: false,
        message: 'An open human-review escalation already exists for this order.',
      };
    }

    throw error;
  }

  return {
    ok: true,
    escalation,
    auditLogEntry,
    unchangedState: {
      orderStatus: snapshot.order.status,
      fulfillmentStatus: snapshot.fulfillment?.status ?? null,
    },
  };
}

function validateEscalation(
  snapshot: OrderSnapshot,
): { ok: true } | { ok: false; message: string } {
  if (snapshot.order.status === 'delivered') {
    return {
      ok: false,
      message: 'Delivered orders do not need a delay or blocker escalation.',
    };
  }

  if (snapshot.order.status === 'refunded' || snapshot.payment?.status === 'refunded') {
    return {
      ok: false,
      message: 'Refunded orders are closed and cannot receive a new ops escalation.',
    };
  }

  if (snapshot.order.issueType === 'none') {
    return {
      ok: false,
      message: 'No operational blocker is present for this synthetic order.',
    };
  }

  const alreadyOpen = snapshot.escalations.some(
    (escalation) => escalation.status === 'open' || escalation.status === 'in_review',
  );

  if (alreadyOpen) {
    return {
      ok: false,
      message: 'An open human-review escalation already exists for this order.',
    };
  }

  return { ok: true };
}

function inferQueue(snapshot: OrderSnapshot): EscalationQueue {
  switch (snapshot.order.issueType) {
    case 'inventory_shortage':
      return 'inventory_review';
    case 'payment_exception':
      return 'payment_review';
    case 'carrier_delay':
      return 'carrier_review';
    case 'stuck_fulfillment':
    case 'refunded':
    case 'none':
      return 'fulfillment_review';
  }
}

function recommendationForQueue(queue: EscalationQueue): string {
  switch (queue) {
    case 'fulfillment_review':
      return 'Human reviewer should inspect the warehouse job and decide whether to retry or requeue fulfillment outside the MCP.';
    case 'inventory_review':
      return 'Human reviewer should confirm stock availability and decide whether to split, restock, or cancel outside the MCP.';
    case 'payment_review':
      return 'Human reviewer should confirm customer/payment follow-up outside the MCP.';
    case 'carrier_review':
      return 'Human reviewer should inspect carrier status and decide whether customer or carrier follow-up is needed outside the MCP.';
  }
}
