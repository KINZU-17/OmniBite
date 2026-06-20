import { SettlementMode } from '@prisma/client';

/**
 * Whether a round is fully paid and may fire. Pure so it can be unit-tested.
 * - SINGLE_PAYER: covered once any payment is confirmed (the one payer).
 * - SPLIT: covered when every active item's participant has a confirmed payment.
 */
export function isRoundCovered(
  mode: SettlementMode | null,
  activeItems: ReadonlyArray<{ participantId: string }>,
  confirmed: ReadonlyArray<{ participantId: string | null }>,
): boolean {
  if (activeItems.length === 0) return false;
  if (confirmed.length === 0) return false;
  if (mode === SettlementMode.SINGLE_PAYER) return true;
  const paid = new Set(confirmed.map((p) => p.participantId));
  return activeItems.every((i) => paid.has(i.participantId));
}
