import { createSeedData } from './seed.js';
import type {
  AuditLogEntry,
  CommerceData,
  Fulfillment,
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

  constructor(data: CommerceData = createSeedData()) {
    this.data = structuredClone(data);
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

  getOrderSnapshot(orderId: string): OrderSnapshot | undefined {
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
      auditLog: this.getAuditLog(orderId),
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

  getAuditLog(orderId: string): AuditLogEntry[] {
    return this.data.auditLog
      .filter((entry) => entry.orderId === orderId)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  updateOrder(orderId: string, updates: Partial<Order>): Order | undefined {
    const order = this.getOrder(orderId);

    if (!order) {
      return undefined;
    }

    Object.assign(order, updates);
    return order;
  }

  updateFulfillment(
    orderId: string,
    updates: Partial<Fulfillment>,
  ): Fulfillment | undefined {
    const fulfillment = this.data.fulfillments.find(
      (candidate) => candidate.orderId === orderId,
    );

    if (!fulfillment) {
      return undefined;
    }

    Object.assign(fulfillment, updates);
    return fulfillment;
  }

  addEvent(event: OrderEvent): OrderEvent {
    this.data.events.push(event);
    return event;
  }

  addAuditLogEntry(entry: AuditLogEntry): AuditLogEntry {
    this.data.auditLog.push(entry);
    return entry;
  }
}

export const commerceStore = new CommerceStore();
