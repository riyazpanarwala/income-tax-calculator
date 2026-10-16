import type { Gain } from './types';
import { add, subtract } from './arithmetic';

/** Current-year eligible equity losses only. Residual losses never reduce another income head. */
export function calculateCapitalGains(input: Gain[]) {
  const total = (kind: Gain['kind'], loss: boolean) =>
    add(
      ...input
        .filter((g) => g.kind === kind && (loss ? g.amount < 0 : g.amount > 0))
        .map((g) => Math.abs(g.amount)),
    );
  const grossShort = total('111A', false),
    grossLong = total('112A', false);
  const shortLoss = total('111A', true),
    longLoss = total('112A', true);
  const longToLong = Math.min(grossLong, longLoss);
  const shortToShort = Math.min(grossShort, shortLoss);
  const shortToLong = Math.min(subtract(shortLoss, shortToShort), subtract(grossLong, longToLong));
  const reductions = { '111A': shortToShort, '112A': add(longToLong, shortToLong) };
  const gains = input.map((g) => {
    const next = { ...g, amount: Math.max(0, g.amount) };
    if (g.kind === '111A' || g.kind === '112A') {
      const used = Math.min(next.amount, reductions[g.kind]);
      next.amount = subtract(next.amount, used);
      reductions[g.kind] = subtract(reductions[g.kind], used);
    }
    return next;
  });
  return {
    gains,
    grossShort,
    grossLong,
    shortLoss,
    longLoss,
    netShort: subtract(grossShort, shortLoss),
    netLong: subtract(grossLong, longLoss),
    shortToShort,
    longToLong,
    shortToLong,
    remainingShortLoss: subtract(shortLoss, shortToShort, shortToLong),
    remainingLongLoss: subtract(longLoss, longToLong),
  };
}
