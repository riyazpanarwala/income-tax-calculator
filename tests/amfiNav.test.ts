import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fixture from './fixtures/portfin-v1.json';
import {
  applyAmfiNav,
  parseAmfiNav,
  loadAmfiNav,
  AMFI_2018_SOURCE,
} from '../src/integrations/amfiNav';
import { importPortFinTaxData, type PortFinExport } from '../src/integrations/portfin';
import { emptyInput } from '../src/tax-engine/types';
import { calculateFinalTax } from '../src/tax-engine/calculateFinalTax';

const header =
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Repurchase Price;Sale Price;Date';
const line = (isin: string, nav: string, code = '1', date = '31-Jan-2018') =>
  `${code};${isin};-;Synthetic Regular Growth;${nav};1;1;${date}`;
const reference = parseAmfiNav(
  readFileSync(new URL('../public/data/amfi-nav-2018-01-31.txt', import.meta.url), 'utf8'),
);

function sample(): PortFinExport {
  const data = structuredClone(fixture) as PortFinExport;
  data.gains = data.gains.slice(0, 1);
  Object.assign(data.gains[0], {
    kind: 'review',
    asset: 'other',
    confirmed: false,
    acquired: '2017-04-01',
    holdingDays: 3378,
    reason: 'Grandfathering requires a separately verified cost basis.',
    instrument: {
      symbol: 'TEST_FUND',
      name: 'Renamed fund',
      isin: 'INF740K01185',
      exchange: 'AMFI',
    },
  });
  data.summary.section111A.gain = 0;
  data.summary.section112A.gain = 0;
  data.summary.review.gain = 1000;
  data.reconciliation = { transactionCount: 1, gainCount: 1, reviewCount: 1, totalGain: 1000 };
  return data;
}

describe('automatic AMFI grandfathering NAVs', () => {
  it('reads exact plan ISINs and preserves all historical NAV decimals in the official snapshot', () => {
    const bytes = readFileSync(new URL('../public/data/amfi-nav-2018-01-31.txt', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '50941f7a6d13647764243eee574e7fad8a4631a58e7c18edf7fbf6c3c43428cd',
    );
    expect(reference.get('INF740K01185')).toEqual([
      {
        schemeCode: '104772',
        schemeName: 'DSP BlackRock Tax Saver Fund - Regular Plan - Growth',
        isin: 'INF740K01185',
        nav: 48.436,
      },
    ]);
    expect(reference.get('INF200K01180')?.[0].nav).toBe(39.2322);
    expect(reference.size).toBeGreaterThan(10000);
  });
  it('loads from the app hosting subdirectory, retries failures, and caches successful lookups', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `${header}\n${line('INF740K01185', '48.436')}`,
      });
    vi.stubGlobal('document', { baseURI: 'https://example.test/income-tax-calculator/' });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(loadAmfiNav()).rejects.toThrow('unavailable');
      const first = loadAmfiNav();
      expect(loadAmfiNav()).toBe(first);
      expect((await first).get('INF740K01185')?.[0].nav).toBe(48.436);
      expect((fetchMock.mock.calls[0][0] as URL).href).toBe(
        'https://example.test/income-tax-calculator/data/amfi-nav-2018-01-31.txt',
      );
      await loadAmfiNav();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('automatically resolves matching mutual-fund lots, preserving source and original report', () => {
    const data = sample();
    const before = structuredClone(data);
    const result = applyAmfiNav(data, reference);
    expect(data).toEqual(before);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].nav).toBe(48.436);
    expect(result.data.gains[0].grandfathering?.source).toContain(AMFI_2018_SOURCE);
    expect(result.data.gains[0].grandfathering?.source).toContain('48.436');
    expect(result.data.gains[0].grandfathering?.fairMarketValue).toBe(484.36);
    const imported = importPortFinTaxData(result.data, emptyInput());
    if (!imported.ok) throw new Error(JSON.stringify(imported.errors));
    expect(imported.reviewRequired).toBe(false);
    expect(imported.importedCount).toBe(1);
    expect(calculateFinalTax(imported.input).ok).toBe(true);
    expect(applyAmfiNav(result.data, reference).data).toEqual(result.data);
  });
  it('uses the exact ISIN even when two plans share a symbol', () => {
    const data = sample();
    data.gains.push({
      ...data.gains[0],
      id: 'different-plan',
      instrument: { ...data.gains[0].instrument, isin: 'INF000000001' },
    });
    const result = applyAmfiNav(data, reference);
    expect(result.data.gains[0].kind).toBe('112A');
    expect(result.data.gains[1].kind).toBe('review');
    expect(result.applied[0].lots).toBe(1);
  });
  it('never guesses unmatched, exchange-listed or otherwise unresolved instruments', () => {
    for (const patch of [
      { instrument: { ...sample().gains[0].instrument, isin: 'INF000000001' } },
      { instrument: { ...sample().gains[0].instrument, exchange: 'NSE' } },
      { reason: 'Tax category or sale-level STT eligibility is unresolved.' },
    ]) {
      const data = sample();
      Object.assign(data.gains[0], patch);
      expect(applyAmfiNav(data, reference)).toEqual({ data, applied: [] });
    }
    const data = sample();
    data.warnings = ['Incomplete source trades'];
    const result = importPortFinTaxData(applyAmfiNav(data, reference).data, emptyInput());
    expect(result.ok && result.reviewRequired).toBe(true);
  });
  it('handles wrapped names, CRLF, reinvestment ISINs and exact duplicate records', () => {
    const row = '2;INF740K01185;INF200K01180;Synthetic\r\nFund;48.436;1;1;31-Jan-2018';
    const ref = parseAmfiNav(`${header}\r\n${row}\r\n${row}`);
    expect(ref.get('INF740K01185')).toHaveLength(1);
    expect(ref.get('INF200K01180')?.[0].schemeName).toBe('Synthetic Fund');
  });
  it('does not choose among conflicting records or use a different date', () => {
    const conflicting = parseAmfiNav(
      `${header}\n${line('INF740K01185', '48.436')}\n${line('INF740K01185', '50.116', '2')}`,
    );
    expect(applyAmfiNav(sample(), conflicting).applied).toEqual([]);
    const wrongDate = `${header}\n${line('INF740K01185', '48.436', '1', '30-Jan-2018')}`;
    expect(() => parseAmfiNav(wrongDate)).toThrow('31 January');
  });
  it.each([
    '<html>error</html>',
    `${header}\n${line('INF740K01185', '-1')}`,
    `${header}\n${line('INF740K01185', 'N.A.')}`,
  ])('rejects unusable reference data', (text) => {
    expect(() => parseAmfiNav(text)).toThrow();
  });
});
