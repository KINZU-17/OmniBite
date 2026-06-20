import { SettlementMode } from '@prisma/client';
import { isRoundCovered } from './coverage';

describe('isRoundCovered', () => {
  const items = [{ participantId: 'a' }, { participantId: 'b' }];

  it('is false with no items', () => {
    expect(isRoundCovered(SettlementMode.SINGLE_PAYER, [], [{ participantId: 'a' }])).toBe(false);
  });

  it('is false with no confirmed payments', () => {
    expect(isRoundCovered(SettlementMode.SINGLE_PAYER, items, [])).toBe(false);
  });

  it('SINGLE_PAYER is covered once any payment confirms', () => {
    expect(isRoundCovered(SettlementMode.SINGLE_PAYER, items, [{ participantId: null }])).toBe(true);
  });

  it('SPLIT is not covered until every participant has paid', () => {
    expect(isRoundCovered(SettlementMode.SPLIT, items, [{ participantId: 'a' }])).toBe(false);
  });

  it('SPLIT is covered when all participants have paid', () => {
    expect(
      isRoundCovered(SettlementMode.SPLIT, items, [{ participantId: 'a' }, { participantId: 'b' }]),
    ).toBe(true);
  });
});
