import type { TaxRules } from '../tax-rules/types';
import { add, subtract } from './arithmetic';
export function calculate87AMarginalRelief(
  total: number,
  normalTax: number,
  specialTax: number,
  resident: boolean,
  r: TaxRules,
) {
  // Section 156(2)(b) uses total income-tax, then 156(3) caps relief at slab tax.
  return resident && total > r.rebate.threshold
    ? Math.min(
        normalTax,
        Math.max(0, subtract(add(normalTax, specialTax), subtract(total, r.rebate.threshold))),
      )
    : 0;
}
