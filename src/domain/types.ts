export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'blocked'
  | 'ready_for_fulfillment'
  | 'fulfillment_in_progress'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type PaymentStatus =
  | 'requires_payment_method'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded';

export type InventoryReservationStatus =
  | 'reserved'
  | 'insufficient_stock'
  | 'released'
  | 'consumed';

export type FulfillmentStatus =
  | 'not_started'
  | 'queued'
  | 'failed'
  | 'retry_requested'
  | 'picking'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type EventType =
  | 'order_created'
  | 'payment_authorized'
  | 'payment_captured'
  | 'payment_failed'
  | 'inventory_reserved'
  | 'inventory_shortage'
  | 'fulfillment_queued'
  | 'fulfillment_failed'
  | 'fulfillment_retry_requested'
  | 'fulfillment_shipped'
  | 'carrier_delay_detected'
  | 'refund_issued'
  | 'ops_note';

export type OrderIssueType =
  | 'stuck_fulfillment'
  | 'payment_exception'
  | 'inventory_shortage'
  | 'carrier_delay'
  | 'refunded'
  | 'none';

export type OrderAction =
  | 'retry_fulfillment'
  | 'release_inventory_reservation'
  | 'escalate_to_warehouse'
  | 'send_customer_update'
  | 'issue_refund';

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
}

export interface Order {
  id: string;
  customer: Customer;
  status: OrderStatus;
  issueType: OrderIssueType;
  items: OrderItem[];
  totalCents: number;
  currency: 'USD';
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  orderId: string;
  provider: 'stripe_mock' | 'adyen_mock';
  status: PaymentStatus;
  amountCents: number;
  capturedAt?: string;
  failureReason?: string;
}

export interface InventoryReservation {
  id: string;
  orderId: string;
  sku: string;
  status: InventoryReservationStatus;
  requestedQuantity: number;
  reservedQuantity: number;
  warehouseId: string;
  failureReason?: string;
}

export interface Fulfillment {
  id: string;
  orderId: string;
  status: FulfillmentStatus;
  warehouseId: string;
  carrier?: 'ups_mock' | 'fedex_mock' | 'usps_mock';
  trackingNumber?: string;
  failureReason?: string;
  lastAttemptedAt?: string;
  shippedAt?: string;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  type: EventType;
  message: string;
  createdAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AuditLogEntry {
  id: string;
  orderId: string;
  action: OrderAction;
  actor: string;
  reason: string;
  result: 'applied' | 'rejected' | 'requires_approval';
  createdAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface CommerceData {
  orders: Order[];
  payments: Payment[];
  inventoryReservations: InventoryReservation[];
  fulfillments: Fulfillment[];
  events: OrderEvent[];
  auditLog: AuditLogEntry[];
}

export interface OrderSnapshot {
  order: Order;
  payment?: Payment;
  inventoryReservations: InventoryReservation[];
  fulfillment?: Fulfillment;
  events: OrderEvent[];
  auditLog: AuditLogEntry[];
}
