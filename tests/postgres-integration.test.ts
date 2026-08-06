import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresPersistence } from '../src/data/persistence.js';
import { CommerceStore } from '../src/data/store.js';
import { createSeedData } from '../src/data/seed.js';
import { createHumanReviewEscalation } from '../src/services/escalation.js';

// These integration tests require a real Postgres database. They are skipped
// when DATABASE_URL is not set so the default `npm test` stays green without
// a database. Point DATABASE_URL at a DISPOSABLE test database only: the
// beforeAll hook truncates the escalations and audit_logs tables.
const DATABASE_URL = process.env.DATABASE_URL;

const describePg = DATABASE_URL ? describe : describe.skip;

describePg('postgres persistence integration', () => {
  let seed: ReturnType<typeof createSeedData>;
  let pool: Pool;
  const openPersistences: PostgresPersistence[] = [];

  beforeAll(async () => {
    seed = createSeedData();
    const bootstrap = new PostgresPersistence(DATABASE_URL!, seed.auditLog);
    await bootstrap.init();
    await bootstrap.close();
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query('TRUNCATE escalations, audit_logs');
  });

  afterAll(async () => {
    await Promise.all(openPersistences.splice(0).map((p) => p.close()));
    await pool.end();
  });

  function makeStore(): CommerceStore {
    const persistence = new PostgresPersistence(DATABASE_URL!, seed.auditLog);
    openPersistences.push(persistence);
    return new CommerceStore(seed, persistence);
  }

  it('seeds the reference audit entry once and init is idempotent', async () => {
    const persistence = new PostgresPersistence(DATABASE_URL!, seed.auditLog);
    openPersistences.push(persistence);

    await persistence.init();
    await persistence.init();

    const audit = await persistence.getAuditLog('ORD-1007');
    const seedEntries = audit.filter((entry) => entry.action === 'escalate_to_warehouse');
    expect(seedEntries).toHaveLength(1);
    expect(seedEntries[0]?.actor).toBe('ops@example.test');
  });

  it('persists escalation creation and audit entries across restart', async () => {
    const storeA = makeStore();

    const result = await createHumanReviewEscalation(storeA, {
      orderId: 'ORD-1008',
      createdBy: 'ops@example.test',
      reason: 'Payment card declined; requires payment review.',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    // A fresh store instance over the same database simulates a process restart.
    const storeB = makeStore();

    const escalations = await storeB.getEscalations('ORD-1008');
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      orderId: 'ORD-1008',
      queue: 'payment_review',
      status: 'open',
      createdBy: 'ops@example.test',
    });

    const audit = await storeB.getAuditLog('ORD-1008');
    expect(audit.some((entry) => entry.action === 'create_human_review_escalation')).toBe(
      true,
    );
    expect(audit.at(-1)?.actor).toBe('ops@example.test');
  });

  it('enforces duplicate handling even across separate instances', async () => {
    const storeA = makeStore();
    const storeB = makeStore();

    const first = await createHumanReviewEscalation(storeA, {
      orderId: 'ORD-1009',
      createdBy: 'ops@example.test',
      reason: 'Inventory shortage requires inventory review.',
    });

    const second = await createHumanReviewEscalation(storeB, {
      orderId: 'ORD-1009',
      createdBy: 'ops@example.test',
      reason: 'Duplicate inventory escalation attempt.',
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      message: 'An open human-review escalation already exists for this order.',
    });
    expect(await storeA.getEscalations('ORD-1009')).toHaveLength(1);
  });
});
