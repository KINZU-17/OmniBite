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
