import { taxYears } from '../tax-rules';
import type { TaxRules } from '../tax-rules/types';
import type { TaxInput, Issue } from './types';
import { validate, validateShape } from './validate';
import { calculateIncome } from './calculateIncome';
import { calculateSlabTax } from './calculateSlabTax';
import { calculateSpecialRateTax } from './calculateSpecialRateTax';
import { calculate87ARebate } from './calculate87ARebate';
import { calculate87AMarginalRelief } from './calculate87AMarginalRelief';
import { calculateSurcharge } from './calculateSurcharge';
import { calculateSurchargeMarginalRelief } from './calculateSurchargeMarginalRelief';
import { calculateCess } from './calculateCess';
import { statutoryRound } from './rounding';
import { add, subtract, roundBalance } from './arithmetic';

function compute(input: TaxInput, r: TaxRules) {
  const income = calculateIncome(input, r);
  const total = statutoryRound(income.unroundedTotal, r.roundingUnit);
  const incomeRounding = subtract(total, income.unroundedTotal);
  // Reconcile rounding against ordinary income, or the sole special category.
  // Ambiguous multi-special apportionment is blocked by the public entry point.
  let normal = income.normal;
  const gains = input.gains.map((g) => ({ ...g }));
  if (normal > 0) normal = subtract(total, income.specialGains);
  else if (gains.some((g) => g.amount > 0)) {
    const first = gains.find((g) => g.amount > 0)!;
    first.amount = add(first.amount, incomeRounding);
  }
  const slab = calculateSlabTax(normal, r);
  const special = calculateSpecialRateTax(gains, normal, input.residency, r);
  const rebate = calculate87ARebate(total, slab.tax, input.residency !== 'non-resident', r);
  const rebateRelief = calculate87AMarginalRelief(
    total,
    slab.tax,
    special.tax,
    input.residency !== 'non-resident',
    r,
  );
  const taxBeforeRelief = add(slab.tax, special.tax);
  const incomeTax = subtract(taxBeforeRelief, rebate, rebateRelief);
  // Tax attributable to ordinary-rate dividends: incremental normal slab tax.
  // Mixed dividend surcharge estimates are blocked until threshold composition is verified.
  const dividendTax = subtract(
    slab.tax,
    calculateSlabTax(Math.max(0, subtract(normal, input.other.dividends)), r).tax,
  );
  const surcharge = calculateSurcharge(
    total,
    Math.max(0, subtract(normal, input.other.dividends)),
    Math.max(0, subtract(slab.tax, rebate, rebateRelief, dividendTax)),
    add(special.tax, dividendTax),
    r,
  );
  const thresholdTax = (threshold: number) => {
    const sole = gains.find((g) => g.amount > 0 && g.kind !== 'otherSTCG');
    if (sole && normal === 0) {
      const base = calculateSpecialRateTax(
        [{ ...sole, amount: threshold }],
        0,
        input.residency,
        r,
      ).tax;
      return add(base, calculateSurcharge(threshold, 0, 0, base, r).total);
    }
    const base = calculateSlabTax(threshold, r).tax;
    const dividendOnly = input.other.dividends > 0 && income.normal === input.other.dividends;
    return add(
      base,
      calculateSurcharge(
        threshold,
        dividendOnly ? 0 : threshold,
        dividendOnly ? 0 : base,
        dividendOnly ? base : 0,
        r,
      ).total,
    );
  };
  const surchargeRelief = calculateSurchargeMarginalRelief(
    total,
    incomeTax,
    surcharge.total,
    thresholdTax,
    r,
  );
  const afterSurcharge = subtract(add(incomeTax, surcharge.total), surchargeRelief.relief);
  const cess = calculateCess(afterSurcharge, r);
  const unroundedLiability = add(afterSurcharge, cess);
  const liability = statutoryRound(unroundedLiability, r.roundingUnit);
  const paid = add(...Object.values(input.payments));
  // Round the balance independently using the unrounded liability to avoid double rounding.
  const net = roundBalance(unroundedLiability, paid, r.roundingUnit);
  return {
    income,
    total,
    incomeRounding,
    normal,
    slab,
    special,
    rebate,
    rebateRelief,
    taxBeforeRelief,
    incomeTax,
    surcharge,
    surchargeRelief,
    cess,
    unroundedLiability,
    liability,
    taxRounding: subtract(liability, unroundedLiability),
    paid,
    net,
    effectiveRate: total ? (liability / total) * 100 : 0,
  };
}
export type TaxResult = ReturnType<typeof compute>;
export type Calculation =
  { ok: true; result: TaxResult; warnings: string[] } | { ok: false; issues: Issue[] };
export function calculateFinalTax(value: unknown, configuredRules?: TaxRules): Calculation {
  const shape = validateShape(value);
  if (shape.length) return { ok: false, issues: shape };
  const input = value as TaxInput;
  const r = configuredRules ?? taxYears[input.year];
  if (!r || r.year !== input.year)
    return {
      ok: false,
      issues: [{ path: 'year', message: 'This tax year has no verified rule configuration.' }],
    };
  const issues = validate(input, r);
  if (issues.length) return { ok: false, issues };
  const income = calculateIncome(input, r);
  if (income.grossTotal > 1_000_000_000_000)
    issues.push({
      path: 'income',
      message: 'Aggregate income above ₹1 lakh crore is outside the supported numeric range.',
    });
  if (
    income.normal > 0 &&
    statutoryRound(income.unroundedTotal, r.roundingUnit) < income.specialGains
  )
    issues.push({
      path: 'gains',
      message:
        'Income rounding would require allocating a reduction across special gains. This rare case is unsupported.',
    });
  const specialKinds = new Set(
    input.gains.filter((g) => g.amount > 0 && g.kind !== 'otherSTCG').map((g) => g.kind),
  );
  if (
    specialKinds.size > 1 &&
    income.normal < r.basicExemption &&
    input.residency !== 'non-resident'
  )
    issues.push({
      path: 'gains',
      message:
        'Multiple special-rate categories with unused basic exemption require an allocation decision. This case is unsupported.',
    });
  if (
    income.normal === 0 &&
    specialKinds.size > 1 &&
    statutoryRound(income.unroundedTotal, r.roundingUnit) !== income.unroundedTotal
  )
    issues.push({
      path: 'gains',
      message: 'Rounding allocation across multiple special-rate categories is unsupported.',
    });
  if (statutoryRound(income.unroundedTotal, r.roundingUnit) > r.surcharge[0].threshold) {
    const mixedSpecial = specialKinds.size > 1 || (specialKinds.size > 0 && income.normal > 0);
    const mixedDividend =
      input.other.dividends > 0 &&
      (income.normal !== input.other.dividends || specialKinds.size > 0);
    if (mixedSpecial || mixedDividend)
      issues.push({
        path: 'gains',
        message:
          'Mixed capital-gain/dividend and other income above ₹50 lakh requires verified surcharge marginal-relief allocation. This estimate is unsupported; use the official calculator or a tax professional.',
      });
  }
  if (issues.length) return { ok: false, issues };
  const result = compute(input, r);
  const warnings: string[] = [];
  if (income.unusablePropertyLoss)
    warnings.push(
      'Net house-property loss is not set off against other income. No carry-forward benefit is calculated under section 202(3).',
    );
  if (input.properties.some((p) => p.occupancy === 'self' && p.interest > 0))
    warnings.push('Self-occupied loan interest is not deductible under the new regime.');
  if (input.salary.employerNps > income.employerNpsLimit)
    warnings.push(
      'Employer NPS exceeds the 14% deduction limit; the excess remains taxable salary.',
    );
  if (input.residency === 'non-resident')
    warnings.push(
      'No resident rebate or basic-exemption adjustment against special gains is applied. Enter only income taxable in India; treaty/special non-resident provisions are unsupported.',
    );
  return { ok: true, result, warnings };
}
