export interface TicketLine {
  id: string;
  station: string;
  status: string;
  roundItem: { quantity: number; notes?: string | null; menuItem: { name: string } };
}
export interface Ticket {
  id: string;
  status: string;
  firedAt: string;
  roundId: string;
  lines: TicketLine[];
}
export interface AggRow {
  name: string;
  quantity: number;
}
export interface KdsConfig {
  locationId: string;
  staffId: string;
}
