import { Pool } from 'pg';
import type { AuditLogEntry, Escalation } from '../domain/types.js';

export class DuplicateOpenEscalationError extends Error {
  constructor() {
    super('An open human-review escalation already exists for this order.');
    this.name = 'DuplicateOpenEscalationError';
  }
}

export interface Persistence {
  init(): Promise<void>;
  close(): Promise<void>;
  getEscalations(orderId: string): Promise<Escalation[]>;
  getAuditLog(orderId: string): Promise<AuditLogEntry[]>;
  createEscalationWithAudit(
    escalation: Escalation,
    auditEntry: AuditLogEntry,
  ): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  private escalations: Escalation[];
  private auditLog: AuditLogEntry[];

  constructor(seedAuditLog: AuditLogEntry[] = []) {
    this.escalations = [];
    this.auditLog = structuredClone(seedAuditLog);
  }

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async getEscalations(orderId: string): Promise<Escalation[]> {
    return this.escalations
      .filter((entry) => entry.orderId === orderId)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getAuditLog(orderId: string): Promise<AuditLogEntry[]> {
    return this.auditLog
      .filter((entry) => entry.orderId === orderId)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createEscalationWithAudit(
    escalation: Escalation,
    auditEntry: AuditLogEntry,
  ): Promise<void> {
    this.escalations.push(escalation);
    this.auditLog.push(auditEntry);
  }
}

export class PostgresPersistence implements Persistence {
  private pool: Pool;
  private seedAuditLog: AuditLogEntry[];

  constructor(connectionString: string, seedAuditLog: AuditLogEntry[] = []) {
    this.pool = createPool(connectionString);
    this.seedAuditLog = seedAuditLog;
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS escalations (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        queue TEXT NOT NULL,
        status TEXT NOT NULL,
        blocker TEXT NOT NULL,
        evidence_summary JSONB NOT NULL,
        recommended_human_action TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_escalations_one_open
        ON escalations (order_id)
        WHERE status IN ('open', 'in_review');

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_order_id
        ON audit_logs (order_id);
    `);

    const { rowCount } = await this.pool.query('SELECT 1 FROM audit_logs LIMIT 1');

    if (rowCount === 0) {
      for (const entry of this.seedAuditLog) {
        await this.pool.query(
          `INSERT INTO audit_logs
             (id, order_id, action, actor, reason, result, created_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            entry.id,
            entry.orderId,
            entry.action,
            entry.actor,
            entry.reason,
            entry.result,
            entry.createdAt,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
          ],
        );
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getEscalations(orderId: string): Promise<Escalation[]> {
    const { rows } = await this.pool.query(
      `SELECT id, order_id, queue, status, blocker, evidence_summary,
              recommended_human_action, created_by, created_at
         FROM escalations
        WHERE order_id = $1
        ORDER BY created_at`,
      [orderId],
    );

    return rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      queue: row.queue,
      status: row.status,
      blocker: row.blocker,
      evidenceSummary: row.evidence_summary,
      recommendedHumanAction: row.recommended_human_action,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));
  }

  async getAuditLog(orderId: string): Promise<AuditLogEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT id, order_id, action, actor, reason, result, created_at, metadata
         FROM audit_logs
        WHERE order_id = $1
        ORDER BY created_at`,
      [orderId],
    );

    return rows.map((row) => {
      const entry: AuditLogEntry = {
        id: row.id,
        orderId: row.order_id,
        action: row.action,
        actor: row.actor,
        reason: row.reason,
        result: row.result,
        createdAt: row.created_at,
      };

      if (row.metadata) {
        entry.metadata = row.metadata;
      }

      return entry;
    });
  }

  async createEscalationWithAudit(
    escalation: Escalation,
    auditEntry: AuditLogEntry,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO escalations
           (id, order_id, queue, status, blocker, evidence_summary,
            recommended_human_action, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          escalation.id,
          escalation.orderId,
          escalation.queue,
          escalation.status,
          escalation.blocker,
          JSON.stringify(escalation.evidenceSummary),
          escalation.recommendedHumanAction,
          escalation.createdBy,
          escalation.createdAt,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs
           (id, order_id, action, actor, reason, result, created_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          auditEntry.id,
          auditEntry.orderId,
          auditEntry.action,
          auditEntry.actor,
          auditEntry.reason,
          auditEntry.result,
          auditEntry.createdAt,
          auditEntry.metadata ? JSON.stringify(auditEntry.metadata) : null,
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');

      if (isUniqueViolation(error)) {
        throw new DuplicateOpenEscalationError();
      }

      throw error;
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function createPool(connectionString: string): Pool {
  const sslMode = new URL(connectionString).searchParams.get('sslmode');

  if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
    return new Pool({
      connectionString,
      max: 5,
      ssl: { rejectUnauthorized: false },
    });
  }

  return new Pool({ connectionString, max: 5 });
}
