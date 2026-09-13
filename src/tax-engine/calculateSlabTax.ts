import type { TaxRules } from '../tax-rules/types';
import { add, subtract, multiply } from './arithmetic';
export function calculateSlabTax(income: number, rules: TaxRules) {
  let lower = 0;
  const rows = rules.slabs.map((s) => {
    const amount = Math.max(0, subtract(Math.min(income, s.upper ?? income), lower));
    const row = { lower, upper: s.upper, rate: s.rate, amount, tax: multiply(amount, s.rate) };
    lower = s.upper ?? lower;
    return row;
  });
  return { rows, tax: add(...rows.map((row) => row.tax)) };
}
