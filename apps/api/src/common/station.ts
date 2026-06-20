import { Station } from '@prisma/client';

/**
 * Maps a menu item's free-text category to a kitchen station for ticket routing.
 * The Phase 1 data model carries category as free text and stations as a fixed
 * enum (GRILL/COLD/FRY/PASS), with no explicit mapping table, so this is the
 * routing rule. Keep it data-driven and easy to extend per location later.
 *
 * Unknown categories fall back to PASS (expediter), so nothing is ever dropped.
 */
const KEYWORDS: Array<[Station, string[]]> = [
  [Station.GRILL, ['grill', 'steak', 'burger', 'bbq', 'roast', 'kebab', 'nyama', 'choma']],
  [Station.FRY, ['fry', 'fries', 'chips', 'fried', 'samosa', 'wings', 'tempura']],
  [Station.COLD, ['cold', 'salad', 'dessert', 'drink', 'beverage', 'juice', 'starter', 'cold-press']],
];

export function resolveStation(category?: string | null): Station {
  if (!category) return Station.PASS;
  const c = category.toLowerCase();
  for (const [station, words] of KEYWORDS) {
    if (words.some((w) => c.includes(w))) return station;
  }
  return Station.PASS;
}
