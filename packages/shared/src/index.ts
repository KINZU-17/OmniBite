/**
 * @omnibite/shared — the API contract shared by the NestJS backend and the React
 * frontends: socket event names, per-location room helpers, and the status string
 * unions that mirror the Prisma enums (so the UI and DB speak the same language).
 */

// --- Real-time rooms (per location, never broadcast to all clients) ----------
export const Rooms = {
  kitchen: (locationId: string): string => `location:${locationId}:kitchen`,
  floor: (locationId: string): string => `location:${locationId}:floor`,
};

// --- Socket events emitted to clients ----------------------------------------
export const Events = {
  /** new paid ticket to the kitchen room */
  TICKET_FIRED: 'ticket.fired',
  /** IN_PREP / READY toggles, to kitchen and floor */
  TICKET_STATUS: 'ticket.status',
  /** runner delivered; closes the loop, updates table state */
  TICKET_SERVED: 'ticket.served',
  /** availability change, to floor and live diner menus */
  ITEM_86: 'item.86',
  /** floor map updates */
  TABLE_STATE: 'table.state',
} as const;

/** In-process NestJS event-emitter channels (backend only, post-commit). */
export const InternalEvents = {
  ROUND_PAID: 'round.paid',
} as const;

export interface RoundPaidEvent {
  roundId: string;
  locationId: string;
  ticketId: string;
  /** etims_invoices rows queued (one per confirmed payment) */
  invoiceIds: string[];
  tableId: string;
}

// --- Status unions (mirror the Prisma enums) ---------------------------------
export type SessionStatus = 'ACTIVE' | 'SETTLED' | 'NEEDS_BUSSING' | 'CLOSED';
export type RoundStatus =
  | 'BUILDING'
  | 'SUBMITTED'
  | 'AWAITING_PAYMENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'FIRED'
  | 'SERVED'
  | 'CANCELLED';
export type SettlementMode = 'SINGLE_PAYER' | 'SPLIT';
export type PaymentMethod = 'MPESA' | 'CARD' | 'CASH';
export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'UNKNOWN'
  | 'CONFIRMED'
  | 'FAILED';
export type TicketStatus = 'QUEUED' | 'IN_PREP' | 'READY' | 'SERVED';
export type Station = 'GRILL' | 'COLD' | 'FRY' | 'PASS';
export type TableFloorState =
  | 'OPEN'
  | 'SEATED'
  | 'ORDERED'
  | 'FOOD_RUNNING'
  | 'PAID'
  | 'NEEDS_BUSSING';
export type EtimsStatus = 'PENDING' | 'TRANSMITTED' | 'FAILED';

// --- Event payloads the frontends consume ------------------------------------
export interface TicketStatusEvent {
  ticketId: string;
  lineId?: string;
  status: TicketStatus;
}
export interface TicketServedEvent {
  ticketId: string;
  tableId: string;
}
export interface Item86Event {
  menuItemId: string;
  is86: boolean;
}
export interface TableStateEvent {
  tableId: string;
  state: TableFloorState;
}
