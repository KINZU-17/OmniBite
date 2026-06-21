// Loose view types for the API responses the diner app consumes.
export interface Modifier {
  id: string;
  name: string;
  priceDelta: string;
}
export interface MenuItem {
  id: string;
  name: string;
  description?: string | null;
  basePrice: string;
  category?: string | null;
  is86: boolean;
  allergens: { allergen: string }[];
  modifierGroups: { modifierGroup: { id: string; name: string; modifiers: Modifier[] } }[];
}
export interface RoundItem {
  id: string;
  quantity: number;
  lineTotal: string;
  status: string;
  menuItem: { name: string };
}
export interface Payment {
  id: string;
  status: string;
  amount: string;
  method: string;
}
export interface Round {
  id: string;
  status: string;
  settlementMode?: string | null;
  items: RoundItem[];
  payments: Payment[];
  kitchenTicket?: { status: string } | null;
}
export interface Session {
  id: string;
  locationId: string;
  participants: { id: string; displayName?: string | null }[];
  rounds: Round[];
}

export type PaymentMethod = 'MPESA' | 'CARD';

/** A card payer's Pesapal hosted-checkout URL, keyed to their payment. */
export interface CardRedirect {
  paymentId: string;
  redirectUrl: string;
}

/** Response of POST /rounds/:id/submit. */
export interface SubmitResult {
  roundId: string;
  status: string;
  payments: Payment[];
  cardRedirects: CardRedirect[];
}
