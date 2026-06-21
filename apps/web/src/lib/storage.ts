export interface SessionCtx {
  participantId: string;
  locationId: string;
  tableId?: string;
}

const key = (sessionId: string) => `omnibite:${sessionId}`;

export function saveCtx(sessionId: string, ctx: SessionCtx): void {
  localStorage.setItem(key(sessionId), JSON.stringify(ctx));
}

export function loadCtx(sessionId: string): SessionCtx | null {
  const v = localStorage.getItem(key(sessionId));
  return v ? (JSON.parse(v) as SessionCtx) : null;
}

// Remember which session to return to after the Pesapal hosted-checkout redirect,
// since the card flow leaves the app entirely and comes back via /card/return.
const CARD_RETURN_KEY = 'omnibite:card-return';

export function saveCardReturn(sessionId: string): void {
  localStorage.setItem(CARD_RETURN_KEY, sessionId);
}

export function loadCardReturn(): string | null {
  return localStorage.getItem(CARD_RETURN_KEY);
}

export function clearCardReturn(): void {
  localStorage.removeItem(CARD_RETURN_KEY);
}
