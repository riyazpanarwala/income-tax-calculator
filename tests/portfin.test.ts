import { describe, expect, it } from 'vitest';
import fixture from './fixtures/portfin-v1.json';
import {
  importPortFinTaxData,
  parsePortFinJson,
  type PortFinExport,
  portFinReviewIssues,
  portFinReviewRecords,
  portFinReport,
  resolveGrandfathering,
} from '../src/integrations/portfin';
import { emptyInput } from '../src/tax-engine/types';
import { calculateFinalTax } from '../src/tax-engine/calculateFinalTax';

const sample = () => structuredClone(fixture) as PortFinExport;
function reconcile(data: PortFinExport) {
  Object.values(data.summary).forEach((b) => {
    b.gain = 0;
    b.loss = 0;
  });
  for (const g of data.gains) {
    const key =
      g.kind === '111A'
        ? 'section111A'
        : g.kind === '112A'
          ? 'section112A'
          : g.kind === '112' || g.kind === 'otherLTCG'
            ? 'otherLTCG'
            : g.kind;
    data.summary[key][g.gain < 0 ? 'loss' : 'gain'] += Math.abs(g.gain);
  }
  data.reconciliation = {
    transactionCount: new Set(data.gains.map((g) => g.transaction)).size,
    gainCount: data.gains.length,
    reviewCount: data.gains.filter((g) => g.kind === 'review' || g.gain < 0).length,
    totalGain: data.gains.reduce((s, g) => s + g.gain, 0),
  };
  return data;
}

describe('PortFin version 1 import', () => {
  it('accepts current exports with expenses and deducts them exactly once', () => {
    const d = sample();
    d.gains[0].transferExpenditure = 25;
    d.gains[0].gain -= 25;
    d.gains[1].transferExpenditure = 0;
    const result = importPortFinTaxData(reconcile(d), emptyInput());
    expect(result.ok).toBe(true);
    expect(result.ok && result.input.gains[0].amount).toBe(975);
    expect(result.ok && result.reviewRequired).toBe(false);
  });
  it('treats absent legacy expenses and explicit zero as the same import', () => {
    const first = importPortFinTaxData(sample(), emptyInput());
    if (!first.ok) throw new Error('fixture');
    const d = sample();
    d.gains.forEach((g) => {
      g.transferExpenditure = 0;
    });
    const result = importPortFinTaxData(d, first.input, { previousFingerprint: first.fingerprint });
    expect(result.ok && result.duplicate).toBe(true);
  });
  it.each([-1, 0.001, null, '25', Infinity, 1e13])(
    'rejects invalid transfer expenditure %s',
    (fee) => {
      const d = sample();
      Object.assign(d.gains[0], { transferExpenditure: fee });
      expect(importPortFinTaxData(d, emptyInput()).ok).toBe(false);
    },
  );
  it('rejects expenses that do not reconcile with the exported gain', () => {
    const d = sample();
    d.gains[0].transferExpenditure = 25;
    expect(importPortFinTaxData(d, emptyInput()).ok).toBe(false);
  });
  it('canonical fingerprints ignore generation time, export-local IDs and object order', () => {
    const first = importPortFinTaxData(sample(), emptyInput());
    if (!first.ok) throw new Error('fixture');
    const d = sample();
    d.generatedAt = '2026-09-21T00:00:00.000Z';
    d.gains = d.gains.reverse().map((g, i) => ({ ...g, id: `new-${i}` }));
    const result = importPortFinTaxData(d, first.input, { previousFingerprint: first.fingerprint });
    expect(result.ok && result.duplicate).toBe(true);
  });
  it('imports the real exporter fixture into the unchanged engine and preserves other fields', () => {
    const current = emptyInput();
    current.salary.basic = 1500000;
    current.properties = [
      { occupancy: 'let', annualValue: 100000, municipalTaxes: 0, interest: 0 },
    ];
    current.other.dividends = 1000;
    current.payments.tds = 5000;
    const before = structuredClone(current);
    const result = importPortFinTaxData(sample(), current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.gains.map((g) => g.kind)).toEqual(['112A', '111A']);
    expect(result.input.gains.map((g) => g.amount)).toEqual([1000, 500]);
    expect(result.input.gains.every((g) => g.asset === 'equity' && g.confirmed)).toBe(true);
    for (const key of ['salary', 'properties', 'other', 'payments', 'unsupported'] as const)
      expect(result.input[key]).toEqual(before[key]);
    expect(current).toEqual(before);
    expect(calculateFinalTax(result.input).ok).toBe(true);
  });

  it.each([
    ['schemaVersion', 2],
    ['source', 'elsewhere'],
    ['financialYear', '2025-26'],
    ['generatedAt', '2026-02-30T00:00:00.000Z'],
    ['extra', 1],
  ])('rejects invalid root %s', (key, value) => {
    const d = { ...sample(), [key]: value };
    expect(importPortFinTaxData(d, emptyInput()).ok).toBe(false);
  });
  it.each([
    ['kind', 'UNKNOWN'],
    ['sold', '2026-02-30'],
    ['acquired', 'bad'],
    ['quantity', -1],
    ['gain', Infinity],
    ['gain', '1000'],
    ['gain', 1.001],
    ['holdingDays', 1],
    ['extra', true],
    ['source', 'api'],
    ['asset', 'gold'],
  ])('rejects invalid lot %s', (key, value) => {
    const d = sample();
    Object.assign(d.gains[0], { [key]: value });
    expect(importPortFinTaxData(d, emptyInput()).ok).toBe(false);
  });
  it('rejects FY mismatch with an actionable message', () => {
    const d = sample();
    d.financialYear = '2025-26';
    const result = importPortFinTaxData(d, emptyInput());
    expect(
      !result.ok &&
        result.errors.some(
          (e) =>
            e.message ===
            'The PortFin export is for FY 2025-26, but this calculator is currently set to FY 2026-27.',
        ),
    ).toBe(true);
  });
  it('handles malformed JSON, oversized files and missing structures', () => {
    expect(() => parsePortFinJson('{bad')).toThrow('valid JSON');
    expect(() => parsePortFinJson(' '.repeat(5000001))).toThrow('5 MB');
    for (const d of [null, [], {}, { ...sample(), gains: null }])
      expect(importPortFinTaxData(d, emptyInput()).ok).toBe(false);
  });
  it.each(['otherSTCG', '112'] as const)(
    'maps verified %s without rebuilding tax logic',
    (kind) => {
      const d = sample();
      d.gains.forEach((g) => {
        g.kind = kind;
        g.asset = 'other';
      });
      const result = importPortFinTaxData(reconcile(d), emptyInput());
      expect(result.ok && result.input.gains.every((g) => g.kind === kind)).toBe(true);
      expect(result.ok && calculateFinalTax(result.input).ok).toBe(true);
    },
  );
  it.each(['review', 'otherLTCG'] as const)('withholds the estimate for %s records', (kind) => {
    const d = sample();
    d.gains[0].kind = kind;
    d.gains[0].confirmed = false;
    d.gains[0].reason = 'Unknown fund eligibility';
    const result = importPortFinTaxData(reconcile(d), emptyInput());
    expect(result.ok && result.reviewRequired).toBe(true);
    expect(result.ok && result.reviewCount).toBe(1);
    expect(result.ok && calculateFinalTax(result.input).ok).toBe(false);
  });
  it('imports signed current-year equity losses and sets them off only within capital gains', () => {
    const d = sample();
    d.gains[1].gain = -500;
    d.gains[1].saleProceeds = 1000;
    const result = importPortFinTaxData(reconcile(d), emptyInput());
    expect(result.ok && result.data.gains[1].gain).toBe(-500);
    expect(result.ok && result.input.gains.map((g) => g.amount)).toEqual([1000, -500]);
    expect(result.ok && result.input.unsupported.losses).toBe(false);
    expect(result.ok && result.reviewRequired).toBe(false);
    expect(result.ok && calculateFinalTax(result.input).ok).toBe(true);
  });
  it('imports all 63 verified equity lots including 31 losses without dropping any rows', () => {
    const d = sample();
    const positive = {
      ...d.gains[0],
      kind: '112A' as const,
      asset: 'equity' as const,
      gain: 100,
      saleProceeds: 1100,
    };
    const negative = {
      ...d.gains[1],
      kind: '111A' as const,
      asset: 'equity' as const,
      gain: -50,
      saleProceeds: 1450,
    };
    d.gains = Array.from({ length: 63 }, (_, i) => ({
      ...(i < 32 ? positive : negative),
      id: `synthetic-lot-${i}`,
      transaction: `synthetic-sale-${i % 9}`,
    }));
    const result = importPortFinTaxData(reconcile(d), emptyInput());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.importedCount).toBe(63);
    expect(result.reviewCount).toBe(0);
    expect(result.reviewRequired).toBe(false);
    expect(portFinReviewIssues(result)).toEqual([]);
    expect(portFinReviewRecords(result)).toHaveLength(0);
    expect(result.input.gains.filter((g) => g.amount < 0)).toHaveLength(31);
    const calculation = calculateFinalTax(result.input);
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.issues));
    expect(calculation.result.income.capitalGains.shortToLong).toBe(1550);
    expect(calculation.result.income.specialGains).toBe(1650);
  });
  it('reconciles older lots in reporting without inventing their verified tax cost', () => {
    const d = sample();
    Object.assign(d.gains[0], {
      kind: 'review',
      asset: 'other',
      confirmed: false,
      acquired: '2017-04-01',
      holdingDays: 3378,
      reason: 'Grandfathering requires a separately verified cost basis.',
    });
    const result = importPortFinTaxData(reconcile(d), emptyInput());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.reviewRequired).toBe(true);
    expect(portFinReport(result.data).find((row) => row.term === 'long')?.net).toBe(1000);
    expect(result.input.gains).toHaveLength(1);
    expect(() => resolveGrandfathering(d, 'SYNTH', 150, '', true)).toThrow('source');
    expect(() => resolveGrandfathering(d, 'SYNTH', 150, 'Synthetic FMV statement', false)).toThrow(
      'confirm',
    );
    const resolved = resolveGrandfathering(d, 'SYNTH', 150, 'Synthetic FMV statement', true);
    const imported = importPortFinTaxData(resolved, emptyInput());
    if (!imported.ok) throw new Error(JSON.stringify(imported.errors));
    expect(imported.reviewRequired).toBe(false);
    expect(imported.input.gains[0].amount).toBe(500);
    expect(imported.input.gains[0].grandfathering?.originalCost).toBe(1000);
    expect(
      calculateFinalTax({ ...imported.input, salary: { ...imported.input.salary, basic: 1500000 } })
        .ok,
    ).toBe(true);
    expect(d.gains[0].costBasis).toBe(1000);
    expect(d.gains[0].kind).toBe('review');
    imported.input.gains[0].amount++;
    expect(calculateFinalTax(imported.input).ok).toBe(false);
    resolved.gains[0].grandfathering!.fairMarketValue = 1;
    expect(importPortFinTaxData(resolved, emptyInput()).ok).toBe(false);
  });
  it('distinguishes source warnings and lot classifications from unsupported loss set-off', () => {
    const d = sample();
    d.gains[0].kind = 'review';
    d.gains[0].confirmed = false;
    d.gains[0].reason = 'Instrument tax eligibility needs confirmation';
    d.warnings = ['Purchases are incomplete'];
    const result = importPortFinTaxData(reconcile(d), emptyInput());
    if (!result.ok) throw new Error('fixture');
    expect(portFinReviewIssues(result).map((issue) => issue.path)).toEqual([
      'PortFin source warning',
      'PortFin lot review',
    ]);
    expect(portFinReviewRecords(result)).toHaveLength(1);
    expect(portFinReviewRecords(result)[0].gain.id).toBe(d.gains[0].id);
    const complete = importPortFinTaxData(sample(), emptyInput());
    if (!complete.ok) throw new Error('fixture');
    expect(portFinReviewIssues(complete)).toEqual([]);
    expect(portFinReviewRecords(complete)).toEqual([]);
  });
  it('keeps unrelated review blockers and source flags after verifying one instrument', () => {
    const d = sample();
    d.gains.forEach((g, i) =>
      Object.assign(g, {
        kind: 'review',
        asset: 'other',
        confirmed: false,
        acquired: '2017-04-01',
        holdingDays: 3378,
        reason: 'Grandfathering requires a separately verified cost basis.',
        instrument: { ...g.instrument, symbol: `SYNTH${i}` },
      }),
    );
    d.warnings = ['Synthetic incomplete-source warning'];
    const data = reconcile(d);
    const partial = resolveGrandfathering(data, 'SYNTH0', 150, 'Synthetic AMC statement', true);
    expect(partial.gains[1]).toEqual(data.gains[1]);
    const result = importPortFinTaxData(partial, emptyInput());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.reviewRequired).toBe(true);
    expect(result.reviewCount).toBe(1);
    expect(portFinReviewIssues(result).map((i) => i.path)).toEqual([
      'PortFin source warning',
      'PortFin lot review',
    ]);
    expect(calculateFinalTax(result.input).ok).toBe(false);
  });
  it('rounds verified lot FMV to paise with decimal half-up and detects repeat verified imports', () => {
    const d = sample();
    d.gains = [
      {
        ...d.gains[0],
        kind: 'review',
        asset: 'other',
        confirmed: false,
        acquired: '2017-04-01',
        holdingDays: 3378,
        quantity: 1,
        costBasis: 1,
        saleProceeds: 2,
        gain: 1,
        reason: 'Grandfathering requires a separately verified cost basis.',
      },
    ];
    const resolved = resolveGrandfathering(
      reconcile(d),
      'SYNTH',
      1.005,
      'Synthetic NAV reference',
      true,
    );
    expect(resolved.gains[0].grandfathering?.fairMarketValue).toBe(1.01);
    expect(resolved.gains[0].gain).toBe(0.99);
    const first = importPortFinTaxData(resolved, emptyInput());
    if (!first.ok) throw new Error(JSON.stringify(first.errors));
    const repeated = importPortFinTaxData(resolved, first.input, {
      previousFingerprint: first.fingerprint,
    });
    expect(repeated.ok && repeated.duplicate).toBe(true);
    expect(repeated.ok && repeated.input.gains).toHaveLength(1);
  });
  it('blocks positive partial estimates when report completeness warnings exist', () => {
    const d = sample();
    d.warnings = ['Missing trades'];
    const result = importPortFinTaxData(d, emptyInput());
    expect(result.ok && calculateFinalTax(result.input).ok).toBe(false);
  });
  it('default replacement is idempotent, and metadata detects repeat exports', () => {
    const first = importPortFinTaxData(sample(), emptyInput());
    if (!first.ok) throw new Error('fixture');
    const again = importPortFinTaxData(sample(), first.input);
    expect(again.ok && again.input.gains).toEqual(first.input.gains);
    const repeat = importPortFinTaxData(sample(), first.input, {
      previousFingerprint: first.fingerprint,
      mode: 'merge',
    });
    expect(repeat.ok && repeat.duplicate).toBe(true);
    expect(repeat.ok && repeat.input).toBe(first.input);
  });
  it('preserves manual entry on explicit merge and prevents matching rows from duplicating', () => {
    const first = importPortFinTaxData(sample(), emptyInput());
    if (!first.ok) throw new Error('fixture');
    const current = first.input;
    current.salary.basic = 1500000;
    current.gains.push({
      kind: 'otherSTCG',
      asset: 'other',
      amount: 250,
      acquired: '2026-04-01',
      sold: '2026-05-01',
      confirmed: true,
    });
    const merged = importPortFinTaxData(sample(), current, { mode: 'merge' });
    expect(merged.ok && merged.input.gains.length).toBe(3);
    expect(merged.ok && calculateFinalTax(merged.input).ok).toBe(true);
    expect(
      importPortFinTaxData(sample(), current, {
        mode: 'merge',
        previousFingerprint: 'older export',
      }).ok,
    ).toBe(false);
  });
  it('rejects tampered totals, duplicate IDs and nested unknown fields', () => {
    const a = sample();
    a.summary.section111A.gain++;
    const b = sample();
    b.gains[1].id = b.gains[0].id;
    const c = sample();
    Object.assign(c.gains[0].instrument, { accountSecret: 'no' });
    for (const d of [a, b, c]) expect(importPortFinTaxData(d, emptyInput()).ok).toBe(false);
  });
  it('does not silently truncate beyond the existing 100-gain input limit', () => {
    const d = sample();
    d.gains = Array.from({ length: 101 }, (_, i) => ({ ...d.gains[0], id: `lot-${i}` }));
    expect(importPortFinTaxData(reconcile(d), emptyInput()).ok).toBe(false);
  });
});
