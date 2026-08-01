import { describe, expect, it } from 'vitest';
import { CommerceStore } from '../src/data/store.js';
import { createHumanReviewEscalation } from '../src/services/escalation.js';
import { investigateSnapshot } from '../src/services/investigation.js';

describe('commerce operations workflow', () => {
  it('diagnoses the stuck fulfillment demo order and recommends escalation', () => {
    const store = new CommerceStore();
    const snapshot = store.getOrderSnapshot('ORD-1007');

    expect(snapshot).toBeDefined();

    const investigation = investigateSnapshot(snapshot!);

    expect(investigation.paymentStatus).toBe('captured');
    expect(investigation.fulfillmentStatus).toBe('failed');
    expect(investigation.inventoryStatuses).toContain('BAG-001:reserved');
    expect(investigation.diagnosis.blocker).toBe('warehouse_job_timeout');
    expect(investigation.diagnosis.recommendedNextAction).toBe(
      'create_human_review_escalation',
    );
  });

  it('marks direct fulfillment retry as human-review-only', () => {
    const store = new CommerceStore();
    const snapshot = store.getOrderSnapshot('ORD-1007');
    const investigation = investigateSnapshot(snapshot!);

    const retryAction = investigation.suggestedActions.find(
      (action) => action.action === 'retry_fulfillment',
    );

    expect(retryAction).toMatchObject({
      allowed: false,
      requiresApproval: true,
      boundary: 'human_review_only',
    });
  });

  it('creates a human-review escalation and audit entry without mutating order state', () => {
    const store = new CommerceStore();
    const before = store.getOrderSnapshot('ORD-1007');

    expect(before).toBeDefined();

    const result = createHumanReviewEscalation(store, {
      orderId: 'ORD-1007',
      createdBy: 'ops@example.test',
      reason: 'Customer escalation after fulfillment timeout.',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    const after = store.getOrderSnapshot('ORD-1007');

    expect(after?.order.status).toBe(before?.order.status);
    expect(after?.fulfillment?.status).toBe(before?.fulfillment?.status);
    expect(result.unchangedState).toEqual({
      orderStatus: 'blocked',
      fulfillmentStatus: 'failed',
    });
    expect(result.escalation).toMatchObject({
      orderId: 'ORD-1007',
      queue: 'fulfillment_review',
      status: 'open',
      blocker: 'warehouse_job_timeout',
      createdBy: 'ops@example.test',
    });
    expect(after?.escalations).toHaveLength(1);
    expect(after?.auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'create_human_review_escalation',
          actor: 'ops@example.test',
          result: 'applied',
        }),
      ]),
    );
  });

  it('rejects duplicate open escalations for the same order', () => {
    const store = new CommerceStore();

    const first = createHumanReviewEscalation(store, {
      orderId: 'ORD-1007',
      createdBy: 'ops@example.test',
      reason: 'Customer escalation after fulfillment timeout.',
    });
    const second = createHumanReviewEscalation(store, {
      orderId: 'ORD-1007',
      createdBy: 'ops@example.test',
      reason: 'Duplicate escalation attempt.',
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      message: 'An open human-review escalation already exists for this order.',
    });
    expect(store.getEscalations('ORD-1007')).toHaveLength(1);
  });

  it('rejects escalation for refunded and unknown orders', () => {
    const store = new CommerceStore();

    expect(
      createHumanReviewEscalation(store, {
        orderId: 'ORD-1011',
        createdBy: 'ops@example.test',
        reason: 'Attempt to escalate closed refunded order.',
      }),
    ).toEqual({
      ok: false,
      message: 'Refunded orders are closed and cannot receive a new ops escalation.',
    });

    expect(
      createHumanReviewEscalation(store, {
        orderId: 'ORD-DOES-NOT-EXIST',
        createdBy: 'ops@example.test',
        reason: 'Unknown order escalation attempt.',
      }),
    ).toEqual({
      ok: false,
      message: 'No synthetic order found for ORD-DOES-NOT-EXIST.',
    });
  });
});
