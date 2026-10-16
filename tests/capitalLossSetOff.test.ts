import { describe, it, expect } from 'vitest';
import { emptyInput, type Gain } from '../src/tax-engine/types';
import { calculateFinalTax } from '../src/tax-engine/calculateFinalTax';
import { calculateCapitalGains } from '../src/tax-engine/calculateCapitalGains';
import { parseAmount } from '../src/format';

const gain = (kind: '111A' | '112A', amount: number): Gain => ({
  kind,
  amount,
  asset: 'equity',
  confirmed: true,
  acquired: kind === '112A' ? '2020-04-01' : '2026-04-01',
  sold: '2026-09-15',
});

describe('current-year eligible equity capital-loss set-off', () => {
  it('uses LTCL only against LTCG and STCL against STCG before LTCG', () => {
    const input = [gain('111A', 100), gain('111A', -180), gain('112A', 500), gain('112A', -200)];
    const before = structuredClone(input);
    const result = calculateCapitalGains(input);
    expect(result.longToLong).toBe(200);
    expect(result.shortToShort).toBe(100);
    expect(result.shortToLong).toBe(80);
    expect(result.gains.map((g) => g.amount)).toEqual([0, 0, 220, 0]);
    expect(result.remainingShortLoss).toBe(0);
    expect(result.remainingLongLoss).toBe(0);
    expect(input).toEqual(before);
  });
  it('never uses LTCL against STCG or leftover losses against salary, interest or dividends', () => {
    const input = emptyInput();
    input.salary.basic = 1500000;
    input.other.interest = 1000;
    input.gains = [gain('111A', 100000), gain('112A', -200000), gain('111A', -150000)];
    const result = calculateFinalTax(input);
    const baseline = calculateFinalTax({ ...input, gains: [] });
    if (!result.ok || !baseline.ok) throw new Error('calculation');
    expect(result.result.liability).toBe(baseline.result.liability);
    expect(result.result.income.capitalGains.remainingShortLoss).toBe(50000);
    expect(result.result.income.capitalGains.remainingLongLoss).toBe(200000);
    expect(result.warnings.join(' ')).toContain('Carry-forward eligibility');
    const onlyLongLoss = calculateCapitalGains([gain('111A', 100000), gain('112A', -200000)]);
    expect(onlyLongLoss.gains[0].amount).toBe(100000);
  });
  it('applies set-off before the annual 112A band, without reducing salary deductions', () => {
    const input = emptyInput();
    input.salary.basic = 1500000;
    input.gains = [gain('112A', 300000), gain('112A', -50000), gain('111A', -25000)];
    const result = calculateFinalTax(input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.result.income.specialGains).toBe(225000);
    expect(result.result.income.standardDeduction).toBe(75000);
    expect(result.result.special.rows.find((row) => row.kind === '112A')?.tax).toBe(12500);
    expect(result.result.total).toBe(1650000);
  });
  it('handles paise, reordered lots, all-loss portfolios and zero lots deterministically', () => {
    const lots = [
      gain('111A', 100.25),
      gain('111A', -200.75),
      gain('112A', 300.1),
      gain('112A', -10.1),
    ];
    for (const input of [lots, [...lots].reverse()]) {
      const result = calculateCapitalGains(input);
      expect(result.shortToLong).toBe(100.5);
      expect(result.gains.reduce((sum, g) => sum + g.amount, 0)).toBe(189.5);
    }
    const input = emptyInput();
    input.gains = [gain('111A', -100.25), gain('112A', -200.25), gain('111A', 0)];
    const result = calculateFinalTax(input);
    expect(result.ok && result.result.liability).toBe(0);
  });
  it('keeps unsupported losses, brought-forward flags and unconfirmed negative lots blocked', () => {
    for (const input of [
      { ...emptyInput(), gains: [{ ...gain('111A', -100), confirmed: false }] },
      { ...emptyInput(), gains: [{ ...gain('111A', -100), kind: 'otherSTCG' }] },
      {
        ...emptyInput(),
        gains: [gain('111A', -100), { ...gain('111A', 500), kind: 'otherSTCG', asset: 'other' }],
      },
      {
        ...emptyInput(),
        unsupported: { ...emptyInput().unsupported, losses: true },
        gains: [gain('111A', -100)],
      },
    ])
      expect(calculateFinalTax(input).ok).toBe(false);
    expect(parseAmount('-1,234.50', true)).toBe(-1234.5);
    expect(parseAmount('-1')).toBeNaN();
    expect(parseAmount('-', true)).toBeNaN();
    expect(calculateFinalTax({ ...emptyInput(), business: -100 }).ok).toBe(false);
  });
  it.each([
    [500, 1000],
    [1500, 500],
    [3000, 0],
  ])('verifies grandfathered cost for FMV %s', (fmv, expected) => {
    const input = emptyInput();
    input.gains = [
      {
        ...gain('112A', expected),
        acquired: '2017-04-01',
        grandfathering: {
          originalCost: 1000,
          fairMarketValue: fmv,
          saleProceeds: 2000,
          expenses: 0,
          source: 'Synthetic statement',
        },
      },
    ];
    expect(calculateFinalTax(input).ok).toBe(true);
  });
  it('preserves a grandfathered loss when original cost exceeds proceeds', () => {
    const input = emptyInput();
    input.gains = [
      {
        ...gain('112A', -510),
        acquired: '2017-04-01',
        grandfathering: {
          originalCost: 2500,
          fairMarketValue: 3000,
          saleProceeds: 2000,
          expenses: 10,
          source: 'Synthetic statement',
        },
      },
    ];
    expect(calculateFinalTax(input).ok).toBe(true);
    input.gains[0].grandfathering!.source = '';
    expect(calculateFinalTax(input).ok).toBe(false);
  });
});
