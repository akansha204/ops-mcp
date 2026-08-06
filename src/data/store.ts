import { createSeedData } from './seed.js';
import { MemoryPersistence, type Persistence } from './persistence.js';
import type {
  AuditLogEntry,
  CommerceData,
  Escalation,
  Order,
  OrderEvent,
  OrderIssueType,
  OrderSnapshot,
} from '../domain/types.js';

export interface OrderSearchFilters {
  status?: Order['status'];
  issueType?: OrderIssueType;
  customerEmail?: string;
}

export class CommerceStore {
  private data: CommerceData;
  private persistence: Persistence;

  constructor(data: CommerceData = createSeedData(), persistence?: Persistence) {
    this.data = structuredClone(data);
    this.persistence =
      persistence ?? new MemoryPersistence(structuredClone(data.auditLog));
  }

  searchOrders(filters: OrderSearchFilters = {}): Order[] {
    return this.data.orders.filter((order) => {
      if (filters.status && order.status !== filters.status) {
        return false;
      }

      if (filters.issueType && order.issueType !== filters.issueType) {
        return false;
      }

      if (
        filters.customerEmail &&
        order.customer.email.toLowerCase() !== filters.customerEmail.toLowerCase()
      ) {
        return false;
      }

      return true;
    });
  }

  getOrder(orderId: string): Order | undefined {
    return this.data.orders.find((order) => order.id === orderId);
  }

  async getOrderSnapshot(orderId: string): Promise<OrderSnapshot | undefined> {
    const order = this.getOrder(orderId);

    if (!order) {
      return undefined;
    }

    const payment = this.data.payments.find((candidate) => candidate.orderId === orderId);
    const fulfillment = this.data.fulfillments.find(
      (candidate) => candidate.orderId === orderId,
    );
    const snapshot: OrderSnapshot = {
      order,
      inventoryReservations: this.data.inventoryReservations.filter(
        (reservation) => reservation.orderId === orderId,
      ),
      events: this.getOrderEvents(orderId),
      auditLog: await this.getAuditLog(orderId),
      escalations: await this.getEscalations(orderId),
    };

    if (payment) {
      snapshot.payment = payment;
    }

    if (fulfillment) {
      snapshot.fulfillment = fulfillment;
    }

    return snapshot;
  }

  getOrderEvents(orderId: string): OrderEvent[] {
    return this.data.events
      .filter((event) => event.orderId === orderId)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getAuditLog(orderId: string): Promise<AuditLogEntry[]> {
    return this.persistence.getAuditLog(orderId);
  }

  async getEscalations(orderId: string): Promise<Escalation[]> {
    return this.persistence.getEscalations(orderId);
  }

  async createEscalationWithAudit(
    escalation: Escalation,
    auditEntry: AuditLogEntry,
  ): Promise<void> {
    await this.persistence.createEscalationWithAudit(escalation, auditEntry);
  }
}
