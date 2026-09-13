import { describe, it, expect } from 'vitest';
import { emptyInput } from '../src/tax-engine/types';
import { calculateFinalTax } from '../src/tax-engine/calculateFinalTax';
import { calculateIncome } from '../src/tax-engine/calculateIncome';
import { rules2026 } from '../src/tax-rules/2026-27';
import { roundBalance } from '../src/tax-engine/arithmetic';
describe('deduction and validation boundaries', () => {
  for (const n of [74999, 75000, 75001]) {
    it(`salary deduction at ${n}`, () => {
      const x = emptyInput();
      x.salary.basic = n;
      expect(calculateIncome(x, rules2026).standardDeduction).toBe(Math.min(n, 75000));
    });
    it(`pension cap at ${n}`, () => {
      const x = emptyInput();
      x.other.familyPension = n;
      expect(calculateIncome(x, rules2026).familyPensionDeduction).toBeCloseTo(
        Math.min(n / 3, 25000),
        10,
      );
    });
  }
  for (const n of [139999, 140000, 140001])
    it(`employer deduction limit ${n}`, () => {
      const x = emptyInput();
      x.salary.basic = 1000000;
      x.salary.employerNps = n;
      expect(calculateIncome(x, rules2026).claimedNps).toBe(Math.min(n, 140000));
    });
  it.each([0.001, 1.234, 100.999])('rejects excess input precision %s', (n) => {
    const x = emptyInput();
    x.business = n;
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('rejects unsupported taxpayer and residency enums', () => {
    expect(calculateFinalTax({ ...emptyInput(), taxpayer: 'huf' }).ok).toBe(false);
    expect(calculateFinalTax({ ...emptyInput(), residency: 'unknown' }).ok).toBe(false);
  });
  it('rejects invalid dates even for a zero-valued populated gain', () => {
    const x = emptyInput();
    x.gains = [
      {
        kind: '111A',
        asset: 'equity',
        amount: 0,
        acquired: '2026-01-01',
        sold: '2026-02-30',
        confirmed: true,
      },
    ];
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('rejects contradictory property holding period', () => {
    const x = emptyInput();
    x.gains = [
      {
        kind: 'otherSTCG',
        asset: 'property',
        amount: 10000,
        acquired: '2020-01-01',
        sold: '2026-08-01',
        confirmed: true,
      },
    ];
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('rejects rounding that would create negative normal income', () => {
    const x = emptyInput();
    x.business = 0.01;
    x.gains = [
      {
        kind: '111A',
        asset: 'equity',
        amount: 400001,
        acquired: '2026-01-01',
        sold: '2026-08-01',
        confirmed: true,
      },
    ];
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('caps aggregate numeric domain without silent clamping', () => {
    const x = emptyInput();
    x.business = 1e12;
    const ok = calculateFinalTax(x);
    expect(ok.ok).toBe(true);
    x.other.savings = 1;
    expect(calculateFinalTax(x).ok).toBe(false);
  });
  it('does not round a large refund through binary subtraction', () => {
    expect(roundBalance(4.99999, 1e12, 10)).toBe(-1e12);
    expect(roundBalance(5.00001, 1e12, 10)).toBe(-999999999990);
  });
  it('resident NPS deduction cannot offset special gains when normal income is exhausted', () => {
    const x = emptyInput();
    x.salary.agniveerGovernment = 100000;
    x.salary.isAgniveer = true;
    x.gains = [
      {
        kind: '111A',
        asset: 'equity',
        amount: 500000,
        acquired: '2026-01-01',
        sold: '2026-08-01',
        confirmed: true,
      },
    ];
    const out = calculateFinalTax(x);
    expect(out.ok && out.result.income.deductions).toBe(25000);
    expect(out.ok && out.result.special.tax).toBe(20000);
  });
});
