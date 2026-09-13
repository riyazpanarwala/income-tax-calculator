import type { TaxRules } from '../tax-rules/types';
import { add, subtract } from './arithmetic';
export function calculateSurchargeMarginalRelief(
  total: number,
  tax: number,
  surcharge: number,
  thresholdTax: (threshold: number) => number,
  r: TaxRules,
) {
  const bracket = r.surcharge.filter((b) => total > b.threshold).at(-1);
  if (!bracket) return { relief: 0, threshold: null, ceiling: null };
  const ceiling = add(thresholdTax(bracket.threshold), subtract(total, bracket.threshold));
  return {
    relief: Math.min(surcharge, Math.max(0, subtract(add(tax, surcharge), ceiling))),
    threshold: bracket.threshold,
    ceiling,
  };
}
