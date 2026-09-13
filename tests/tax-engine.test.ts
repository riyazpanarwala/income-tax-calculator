import { describe, it, expect } from 'vitest';
import { emptyInput, type TaxInput, type Gain } from '../src/tax-engine/types';
import { rules2026 as r } from '../src/tax-rules/2026-27';
import { calculateFinalTax } from '../src/tax-engine/calculateFinalTax';
import { calculateSlabTax } from '../src/tax-engine/calculateSlabTax';
import { calculate87AMarginalRelief } from '../src/tax-engine/calculate87AMarginalRelief';
import { calculateSpecialRateTax } from '../src/tax-engine/calculateSpecialRateTax';
import { calculateSurcharge } from '../src/tax-engine/calculateSurcharge';
import { calculateIncome } from '../src/tax-engine/calculateIncome';
import { statutoryRound } from '../src/tax-engine/rounding';
import { officialFixtures } from './official-fixtures';
import { parseAmount, money } from '../src/format';
const ordinary = (income: number) => {
  const x = emptyInput();
  x.business = income;
  return x;
};
const calc = (x: TaxInput) => {
  const out = calculateFinalTax(x);
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out.result;
};
const gain = (kind: Gain['kind'], amount: number): Gain => ({
  kind,
  amount,
  asset: kind === '112' ? 'other' : 'equity',
  acquired: ['111A', 'otherSTCG'].includes(kind) ? '2026-01-01' : '2024-01-01',
  sold: '2026-08-01',
  confirmed: true,
});
// Independent hand-derived piecewise oracle, intentionally not driven by configuration.
function oracle(n: number) {
  if (n <= 400000) return 0;
  if (n <= 800000) return (n - 400000) * 0.05;
  if (n <= 1200000) return 20000 + (n - 800000) * 0.1;
  if (n <= 1600000) return 60000 + (n - 1200000) * 0.15;
  if (n <= 2000000) return 120000 + (n - 1600000) * 0.2;
  if (n <= 2400000) return 200000 + (n - 2000000) * 0.25;
  return 300000 + (n - 2400000) * 0.3;
}
describe('progressive slabs and boundaries', () => {
  for (const threshold of [
    0, 400000, 800000, 1200000, 1600000, 2000000, 2400000, 5000000, 10000000, 20000000, 50000000,
  ])
    for (const delta of [-1, 0, 1])
      if (threshold + delta >= 0)
        it(`income ${threshold + delta}`, () => {
          const n = threshold + delta;
          const slab = calculateSlabTax(n, r);
          expect(slab.tax).toBeCloseTo(oracle(n), 6);
          expect(slab.rows.reduce((a, b) => a + b.amount, 0)).toBe(n);
          const result = calc(ordinary(n));
          expect(result.total).toBe(Math.floor((Math.floor(n) + 5) / 10) * 10);
          expect(result.liability).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(result.net)).toBe(true);
        });
  it('does not apply the top rate to the entire income', () =>
    expect(calc(ordinary(2400000)).slab.tax).toBe(300000));
  it('very high income uses maximum 25% surcharge', () => {
    const x = calc(ordinary(10000000000));
    expect(x.surcharge.rate).toBe(0.25);
    expect(x.liability).toBe(3899454000);
  });
  it('zero input is zero throughout', () => {
    const x = calc(emptyInput());
    expect([x.total, x.slab.tax, x.rebate, x.cess, x.net, x.effectiveRate]).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
  });
});
describe('salary, deductions, property and other income', () => {
  for (const [salary, taxable, tax] of [
    [50000, 0, 0],
    [75000, 0, 0],
    [75001, 0, 0],
    [1250000, 1175000, 0],
    [1275000, 1200000, 0],
    [1500000, 1425000, 97500],
  ])
    it(`salary ${salary}`, () => {
      const x = emptyInput();
      x.salary.basic = salary;
      const z = calc(x);
      expect(z.total).toBe(taxable);
      expect(z.liability).toBe(tax);
      expect(z.income.salary).toBe(Math.max(0, salary - 75000));
    });
  it('caps standard deduction once for all components', () => {
    const x = emptyInput();
    x.salary.basic = 100000;
    x.salary.bonus = 100000;
    expect(calc(x).income.standardDeduction).toBe(75000);
  });
  it('applies no standard deduction to business income', () =>
    expect(calc(ordinary(1275000)).liability).toBe(74100));
  it('adds employer NPS to salary and limits deduction to 14% eligible base', () => {
    const x = emptyInput();
    x.salary.basic = 1000000;
    x.salary.da = 200000;
    x.salary.npsEligibleDa = 100000;
    x.salary.employerNps = 200000;
    const z = calc(x);
    expect(z.income.grossSalary).toBe(1400000);
    expect(z.income.claimedNps).toBe(154000);
    expect(z.total).toBe(1171000);
  });
  it('validates eligible DA', () => {
    const x = emptyInput();
    x.salary.npsEligibleDa = 1;
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('Agniveer government contribution is included then deducted', () => {
    const x = emptyInput();
    x.salary.basic = 500000;
    x.salary.agniveerGovernment = 50000;
    x.salary.isAgniveer = true;
    expect(calc(x).total).toBe(425000);
    x.salary.isAgniveer = false;
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  for (const [pension, deduction] of [
    [30000, 10000],
    [75000, 25000],
    [90000, 25000],
  ])
    it(`family pension ${pension}`, () => {
      const x = emptyInput();
      x.other.familyPension = pension;
      expect(calc(x).income.familyPensionDeduction).toBe(deduction);
      expect(calc(x).income.standardDeduction).toBe(0);
    });
  it('preserves fractional family pension without intermediate rupee rounding', () => {
    const x = emptyInput();
    x.other.familyPension = 100;
    expect(calculateIncome(x, r).familyPensionDeduction).toBeCloseTo(100 / 3, 12);
  });
  it('allows let-out interest and 30% NAV deduction', () => {
    const x = emptyInput();
    x.properties = [
      { occupancy: 'let', annualValue: 500000, municipalTaxes: 50000, interest: 100000 },
    ];
    expect(calc(x).income.house).toBe(215000);
  });
  it('aggregates losses within house head but never sets off net loss against salary', () => {
    const x = ordinary(1500000);
    x.properties = [
      { occupancy: 'let', annualValue: 100000, municipalTaxes: 0, interest: 200000 },
      { occupancy: 'let', annualValue: 100000, municipalTaxes: 0, interest: 0 },
    ];
    const z = calc(x);
    expect(z.income.propertyNet).toBe(-60000);
    expect(z.total).toBe(1500000);
    expect(z.income.unusablePropertyLoss).toBe(60000);
  });
  it('disallows self-occupied loan interest', () => {
    const x = ordinary(1500000);
    x.properties = [{ occupancy: 'self', annualValue: 0, municipalTaxes: 0, interest: 200000 }];
    expect(calc(x).total).toBe(1500000);
  });
});
describe('resident rebate and 87A marginal relief', () => {
  it.each(['resident', 'rnor'] as const)('%s eligible for rebate', (residency) => {
    const x = ordinary(1200000);
    x.residency = residency;
    expect(calc(x).rebate).toBe(60000);
  });
  it('NRI has no rebate or marginal relief', () => {
    const x = ordinary(1250000);
    x.residency = 'non-resident';
    expect(calc(x).rebateRelief).toBe(0);
    expect(calc(x).liability).toBe(70200);
  });
  it('age does not change new regime slabs', () => {
    const x = ordinary(1500000);
    x.age = 80;
    expect(calc(x).liability).toBe(calc(ordinary(1500000)).liability);
  });
  it.each([
    [1200001, 59999.15],
    [1200010, 59991.5],
    [1250000, 17500],
    [1270590, 0],
  ])('unrounded rebate relief at %s', (total, relief) =>
    expect(calculate87AMarginalRelief(total, oracle(total), 0, true, r)).toBeCloseTo(relief, 6),
  );
  it('rounds total income before the rebate eligibility test', () => {
    expect(calc(ordinary(1200001)).liability).toBe(0);
    expect(calc(ordinary(1200005)).liability).toBe(10);
  });
  it('rebate never absorbs special tax', () => {
    const x = ordinary(800000);
    x.gains = [gain('111A', 100000)];
    const z = calc(x);
    expect(z.rebate).toBe(20000);
    expect(z.special.tax).toBe(20000);
    expect(z.liability).toBe(20800);
  });
  it('uses total tax then caps mixed-income marginal relief at normal tax', () => {
    const x = ordinary(1150000);
    x.gains = [gain('111A', 100000)];
    const z = calc(x);
    expect(z.rebateRelief).toBe(25000);
    expect(z.liability).toBe(52000);
  });
  it('112A tax-free band still counts towards rebate threshold', () => {
    const x = ordinary(1200000);
    x.gains = [gain('112A', 125000)];
    const z = calc(x);
    expect(z.total).toBe(1325000);
    expect(z.rebate).toBe(0);
    expect(z.special.tax).toBe(0);
    expect(z.liability).toBe(62400);
  });
});
describe('capital gains', () => {
  it.each([
    ['111A', 20000],
    ['112', 12500],
    ['112A', 0],
  ] as const)('%s rate at normal income over basic exemption', (kind, tax) => {
    const x = ordinary(500000);
    x.gains = [gain(kind, 100000)];
    expect(calc(x).special.tax).toBe(tax);
  });
  it('112A annual exemption is aggregated once', () => {
    const x = ordinary(500000);
    x.gains = [gain('112A', 100000), gain('112A', 100000)];
    expect(calc(x).special.tax).toBe(9375);
  });
  for (const n of [124999, 125000, 125001])
    it(`112A exempt band boundary ${n}`, () =>
      expect(calculateSpecialRateTax([gain('112A', n)], 500000, 'resident', r).tax).toBeCloseTo(
        Math.max(0, n - 125000) * 0.125,
        9,
      ));
  it('resident basic exemption adjusts special gains', () => {
    const x = emptyInput();
    x.gains = [gain('111A', 500000)];
    expect(calc(x).special.tax).toBe(20000);
    x.residency = 'non-resident';
    expect(calc(x).special.tax).toBe(100000);
  });
  it('112A basic exemption adjustment precedes exempt tax band', () => {
    const x = emptyInput();
    x.gains = [gain('112A', 600000)];
    expect(calc(x).special.tax).toBe(9375);
  });
  it('other STCG is taxed at normal slabs', () => {
    const x = ordinary(1000000);
    x.gains = [gain('otherSTCG', 500000)];
    expect(calc(x).special.tax).toBe(0);
    expect(calc(x).slab.tax).toBe(105000);
  });
  it('blocks ambiguous shared basic exemption', () => {
    const x = emptyInput();
    x.gains = [gain('111A', 100000), gain('112A', 100000)];
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('supports mixed capital gains once normal income exhausts basic exemption', () => {
    const x = ordinary(800000);
    x.gains = [gain('111A', 100000), gain('112A', 200000), gain('112', 100000)];
    expect(calc(x).special.tax).toBe(41875);
  });
  it('blocks grandfathering and property indexation protection', () => {
    const x = emptyInput();
    x.gains = [{ ...gain('112A', 100000), acquired: '2017-01-01' }];
    expect(calculateFinalTax(x).ok).toBe(false);
    x.gains = [{ ...gain('112', 100000), asset: 'property' }];
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('validates leap days, transfer year, order and holding period', () => {
    for (const g of [
      { ...gain('111A', 1), sold: '2026-02-30' },
      { ...gain('111A', 1), sold: '2025-09-01' },
      { ...gain('111A', 1), acquired: '2027-02-01' },
      { ...gain('112A', 1), acquired: '2026-01-01' },
    ]) {
      const x = emptyInput();
      x.gains = [g];
      expect(calculateFinalTax(x).ok).toBe(false);
    }
  });
});
describe('surcharge and distinct marginal relief', () => {
  for (const [threshold, base, rate] of [
    [5000000, 1080000, 0.1],
    [10000000, 2838000, 0.15],
    [20000000, 6417000, 0.25],
  ])
    for (const delta of [-1, 0, 1, 10, 10000])
      it(`surcharge threshold ${threshold} ${delta}`, () => {
        const z = calc(ordinary(threshold + delta));
        if (z.total > threshold) {
          expect(z.surcharge.rate).toBe(rate);
          expect(z.incomeTax + z.surcharge.total - z.surchargeRelief.relief).toBeCloseTo(
            Math.min(z.incomeTax + z.surcharge.total, base + z.total - threshold),
            5,
          );
        }
        expect(z.rebateRelief).toBe(0);
      });
  it('15% cap on pure special-rate income at 3 crore', () => {
    const x = emptyInput();
    x.gains = [gain('111A', 30000000)];
    const z = calc(x);
    expect(z.surcharge.cappedRate).toBe(0.15);
    expect(z.surcharge.capped).toBe(888000);
    expect(z.surchargeRelief.relief).toBe(0);
    expect(z.liability).toBe(7080320);
  });
  it('surcharge marginal relief on a single special category', () => {
    const x = emptyInput();
    x.gains = [gain('111A', 5000010)];
    const z = calc(x);
    expect(z.incomeTax + z.surcharge.total - z.surchargeRelief.relief).toBe(920010);
  });
  it('dividend-only surcharge is capped at 15%', () => {
    const x = emptyInput();
    x.other.dividends = 30000000;
    expect(calc(x).surcharge.cappedRate).toBe(0.15);
    expect(calc(x).surcharge.ordinary).toBe(0);
  });
  it('allocates 25% ordinary and 15% special surcharge separately', () => {
    const s = calculateSurcharge(40000000, 30000000, 1000000, 500000, r);
    expect(s.total).toBe(325000);
  });
  it('special gains alone cannot trigger 25% on other tax', () => {
    expect(calculateSurcharge(40000000, 10000000, 1000000, 500000, r).total).toBe(225000);
  });
  it('blocks mixed surcharge estimates until composition is verified', () => {
    const x = ordinary(5000000);
    x.gains = [gain('111A', 100000)];
    expect(calculateFinalTax(x).ok).toBe(false);
    x.gains = [];
    x.other.dividends = 100000;
    expect(calculateFinalTax(x).ok).toBe(false);
  });
});
describe('rounding, cess and payments', () => {
  it.each([
    [4.99, 0],
    [5, 10],
    [14.99, 10],
    [15, 20],
    [-5, -10],
    [-14.99, -10],
  ])('rounds %s to %s', (n, expected) => expect(statutoryRound(n)).toBe(expected));
  it('cess follows rebate and both reliefs', () => {
    const z = calc(ordinary(5000010));
    expect(z.cess).toBeCloseTo(43200.4, 6);
  });
  it('all tax credits reduce payable without changing gross tax', () => {
    const x = ordinary(1500000);
    x.payments = { tds: 100000, tcs: 10000, advance: 20000, selfAssessment: 5000 };
    const z = calc(x);
    expect(z.liability).toBe(109200);
    expect(z.paid).toBe(135000);
    expect(z.net).toBe(-25800);
  });
  it('rounds balance independently rather than double rounding', () => {
    const x = ordinary(1250010);
    x.payments.tds = 5;
    const z = calc(x);
    expect(z.unroundedLiability).toBeCloseTo(52010.4, 6);
    expect(z.net).toBe(52010);
  });
  it('zero income with payments produces a refund', () => {
    const x = emptyInput();
    x.payments.tds = 50000;
    expect(calc(x).net).toBe(-50000);
  });
});
describe('public API validation', () => {
  it.each(['12,34', '1e6', 'Infinity', 'abc', '-1', '12.345'])(
    'rejects malformed amount %s',
    (value) => expect(Number.isNaN(parseAmount(value))).toBe(true),
  );
  it.each(['125000', '1,25,000', '125000.00', '1,25,000.00'])('parses INR input %s', (value) =>
    expect(parseAmount(value)).toBe(125000),
  );
  it('uses Indian currency formatting without negative zero', () => {
    expect(money(12500000)).toBe('₹1,25,00,000');
    expect(money(-0)).toBe('₹0');
  });
  it.each([-1, NaN, Infinity, 1e14, '1000', null, undefined])(
    'rejects invalid money %s',
    (value) => {
      const x = ordinary(1000);
      (x as unknown as { business: unknown }).business = value;
      expect(calculateFinalTax(x).ok).toBe(false);
    },
  );
  it.each([null, {}, [], { salary: null }])('rejects malformed input structures', (value) =>
    expect(calculateFinalTax(value).ok).toBe(false),
  );
  it('rejects unknown fields, unavailable deductions and manual rebate claims', () => {
    expect(calculateFinalTax({ ...emptyInput(), deduction80C: 150000 }).ok).toBe(false);
    expect(calculateFinalTax({ ...emptyInput(), rebate: 60000 }).ok).toBe(false);
  });
  it.each(Object.keys(emptyInput().unsupported))('blocks unsupported flag %s', (key) => {
    const x = emptyInput();
    x.unsupported[key as keyof TaxInput['unsupported']] = true;
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('refuses unknown tax years', () => {
    const x = emptyInput();
    x.year = '2027-28';
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('reads an injected year configuration without rewriting the engine', () => {
    const x = ordinary(1500000);
    x.year = 'test';
    const out = calculateFinalTax(x, {
      ...r,
      year: 'test',
      slabs: [{ upper: null, rate: 0.1 }],
      rebate: { threshold: 0, maximum: 0 },
    });
    expect(out.ok && out.result.slab.tax).toBe(150000);
  });
  it('deterministic and does not mutate input', () => {
    const x = exampleInput();
    const saved = structuredClone(x);
    expect(calculateFinalTax(x)).toEqual(calculateFinalTax(x));
    expect(x).toEqual(saved);
  });
});
function exampleInput() {
  const x = ordinary(800000);
  x.gains = [gain('112A', 100000)];
  return x;
}
describe('official UI regression fixtures', () => {
  for (const fixture of officialFixtures)
    it(`official tax-year 2026-27 income ${fixture.income}`, () => {
      const input = ordinary(fixture.income);
      input.residency = fixture.residency ?? 'resident';
      const z = calc(input);
      expect(z.slab.tax).toBe(fixture.slab);
      expect(z.rebate + z.rebateRelief).toBe(fixture.rebate);
      expect(z.surcharge.total - z.surchargeRelief.relief).toBeCloseTo(fixture.surcharge, 4);
      expect(Math.round(z.cess)).toBe(fixture.cess);
      expect(z.liability).toBe(fixture.liability);
    });
});
