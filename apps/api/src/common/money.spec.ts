import { computeLineTotal, round2, sum, taxFromGross } from './money';

describe('money', () => {
  it('computes a line total with modifier deltas and quantity', () => {
    // (850 base + 150 large) * 2 = 2000
    expect(computeLineTotal(850, [150], 2).toString()).toBe('2000');
  });

  it('handles negative modifier deltas', () => {
    expect(computeLineTotal(500, [-50, 0], 1).toString()).toBe('450');
  });

  it('rounds half-up to 2dp', () => {
    expect(round2('10.005').toString()).toBe('10.01');
  });

  it('sums decimals', () => {
    expect(sum([100, 200.5, 0.5]).toString()).toBe('301');
  });

  it('extracts VAT from a tax-inclusive gross (16%)', () => {
    // 1160 gross at 16% -> 160 tax
    expect(taxFromGross(1160, 16).toString()).toBe('160');
  });

  it('returns zero tax for a zero-rated line', () => {
    expect(taxFromGross(500, 0).toString()).toBe('0');
  });
});
