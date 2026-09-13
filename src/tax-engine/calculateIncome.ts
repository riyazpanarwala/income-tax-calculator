import type { TaxInput } from './types';
import type { TaxRules } from '../tax-rules/types';
import { add, subtract, multiply, divide } from './arithmetic';
export function calculateIncome(input: TaxInput, r: TaxRules) {
  const s = input.salary;
  const grossSalary = add(
    s.basic,
    s.da,
    s.bonus,
    s.commission,
    s.allowances,
    s.perquisites,
    s.other,
    s.employerNps,
    s.agniveerGovernment,
  );
  const standardDeduction = Math.min(grossSalary, r.salaryDeduction);
  const salary = subtract(grossSalary, standardDeduction);
  const propertyRows = input.properties.map((p) => {
    const nav = p.occupancy === 'let' ? subtract(p.annualValue, p.municipalTaxes) : 0;
    const deduction = multiply(nav, r.houseDeductionRate);
    return {
      ...p,
      nav,
      deduction,
      income: p.occupancy === 'let' ? subtract(nav, deduction, p.interest) : 0,
    };
  });
  const propertyNet = add(...propertyRows.map((p) => p.income));
  const house = Math.max(0, propertyNet);
  const familyPensionDeduction = Math.min(
    divide(input.other.familyPension, r.familyPension.divisor),
    r.familyPension.maximum,
  );
  const other = subtract(add(...Object.values(input.other)), familyPensionDeduction);
  const ordinaryGains = add(
    ...input.gains.filter((g) => g.kind === 'otherSTCG').map((g) => g.amount),
  );
  const specialGains = add(
    ...input.gains.filter((g) => g.kind !== 'otherSTCG').map((g) => g.amount),
  );
  const normalGross = add(salary, house, input.business, other, ordinaryGains);
  const employerNpsLimit = multiply(
    add(s.basic, s.npsEligibleDa),
    r.deductions.employerNps.rate ?? 0,
  );
  const claimedNps = Math.min(s.employerNps, employerNpsLimit);
  const claimedAgniveer = s.isAgniveer ? s.agniveerGovernment : 0;
  const deductions = Math.min(normalGross, add(claimedNps, claimedAgniveer));
  const normal = subtract(normalGross, deductions);
  return {
    grossSalary,
    standardDeduction,
    salary,
    propertyRows,
    propertyNet,
    house,
    unusablePropertyLoss: Math.max(0, -propertyNet),
    familyPensionDeduction,
    other,
    business: input.business,
    ordinaryGains,
    specialGains,
    normalGross,
    employerNpsLimit,
    claimedNps,
    claimedAgniveer,
    deductions,
    normal,
    grossTotal: add(normalGross, specialGains),
    unroundedTotal: add(normal, specialGains),
  };
}
