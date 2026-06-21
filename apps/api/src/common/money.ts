import { Prisma } from '@prisma/client';

/**
 * Money helpers. All money is Prisma.Decimal (numeric(12,2) in KES) so we never
 * touch floating point. KES has no minor-unit subdivision in practice, but the
 * schema keeps 2dp for VAT math, so we round half-up to 2dp at the boundaries.
 */

const Decimal = Prisma.Decimal;
export type Money = Prisma.Decimal;

export function money(value: Prisma.Decimal.Value): Money {
  return new Decimal(value);
}

export const ZERO: Money = new Decimal(0);

export function sum(values: Prisma.Decimal.Value[]): Money {
  return values.reduce<Money>(
    (acc, v) => acc.add(new Decimal(v)),
    new Decimal(0),
  );
}

/** Round half-up to 2 decimal places. */
export function round2(value: Prisma.Decimal.Value): Money {
  return new Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Line total = (unit price + sum of modifier deltas) * quantity, to 2dp.
 * Modifier deltas may be negative (e.g. "no cheese").
 */
export function computeLineTotal(
  unitPrice: Prisma.Decimal.Value,
  modifierDeltas: Prisma.Decimal.Value[],
  quantity: number,
): Money {
  const perUnit = new Decimal(unitPrice).add(sum(modifierDeltas));
  return round2(perUnit.mul(quantity));
}

/**
 * Tax-inclusive VAT split. Kenyan menu prices are VAT-inclusive, so for a gross
 * line at rate r%, the tax component is gross * r / (100 + r).
 */
export function taxFromGross(
  gross: Prisma.Decimal.Value,
  ratePercent: Prisma.Decimal.Value,
): Money {
  const rate = new Decimal(ratePercent);
  return round2(new Decimal(gross).mul(rate).div(rate.add(100)));
}

export function eq(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): boolean {
  return new Decimal(a).equals(new Decimal(b));
}

export function gte(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): boolean {
  return new Decimal(a).gte(new Decimal(b));
}
