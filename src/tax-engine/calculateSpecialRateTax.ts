import type { Gain, Residency } from './types';
import type { TaxRules } from '../tax-rules/types';
import { add, subtract, multiply } from './arithmetic';
export function calculateSpecialRateTax(
  gains: Gain[],
  normal: number,
  residency: Residency,
  r: TaxRules,
) {
  let unusedBasic =
    residency === 'non-resident' ? 0 : Math.max(0, subtract(r.basicExemption, normal));
  const rows = (['111A', '112', '112A'] as const).map((kind) => {
    const amount = add(...gains.filter((g) => g.kind === kind).map((g) => g.amount));
    const basicAdjustment = Math.min(amount, unusedBasic);
    unusedBasic = subtract(unusedBasic, basicAdjustment);
    const exemption = Math.min(
      Math.max(0, subtract(amount, basicAdjustment)),
      r.special[kind].exemption,
    );
    const taxable = Math.max(0, subtract(amount, basicAdjustment, exemption));
    return {
      kind,
      amount,
      basicAdjustment,
      exemption,
      taxable,
      rate: r.special[kind].rate,
      tax: multiply(taxable, r.special[kind].rate),
    };
  });
  return { rows, tax: add(...rows.map((row) => row.tax)) };
}
