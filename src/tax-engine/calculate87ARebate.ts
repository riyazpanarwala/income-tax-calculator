import type { TaxRules } from '../tax-rules/types';
export function calculate87ARebate(
  total: number,
  normalTax: number,
  resident: boolean,
  r: TaxRules,
) {
  return resident && total <= r.rebate.threshold ? Math.min(normalTax, r.rebate.maximum) : 0;
}
