import type { TaxRules } from '../tax-rules/types';
import { add, multiply } from './arithmetic';
export function surchargeRate(total: number, r: TaxRules) {
  return r.surcharge.reduce((rate, b) => (total > b.threshold ? b.rate : rate), 0);
}
export function calculateSurcharge(
  total: number,
  uncappedIncome: number,
  uncappedTax: number,
  cappedTax: number,
  r: TaxRules,
) {
  let rate = surchargeRate(total, r);
  // Finance Act schedule: excluded gains/dividends alone do not trigger 25% on ordinary tax.
  if (uncappedIncome <= r.surcharge.at(-1)!.threshold) rate = Math.min(rate, r.specialSurchargeCap);
  const cappedRate = Math.min(surchargeRate(total, r), r.specialSurchargeCap);
  const ordinary = multiply(uncappedTax, rate),
    capped = multiply(cappedTax, cappedRate);
  return { rate, cappedRate, ordinary, capped, total: add(ordinary, capped) };
}
