import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseBrokerFile, parseWorkbookData } from '../src/brokerParser';
import { detectShoonyaFno, prepareFnoImport } from '../src/integrations/shoonyaFno';
import { emptyInput } from '../src/tax-engine/types';
import { calculateFinalTax } from '../src/tax-engine/calculateFinalTax';

const header = [
  'Exchange',
  'Segment',
  'Instrument',
  'Symbol',
  'Expiry Date',
  'Strike Price',
  'Option Type',
  'BF Quantity',
  'BF Value',
  'Buy Quantity',
  'Buy Value',
  'Buy Average Rate',
  'Sell Quantity',
  'Sell Value',
  'Sell Average Rate',
  'CL Quantity',
  'CL Value',
  'CA Quantity',
  'CA Value',
  'Net Quantity',
  'Net Value',
  'Average Rate',
  'Close Rate',
  'PNL',
];
function fixture(loss = false) {
  const pnl = loss ? -100 : 100;
  const row = [
    'NSE',
    'FNO',
    'OPTIDX',
    'TESTINDEX',
    '15/10/2026',
    20000,
    'CE',
    0,
    0,
    10,
    1000,
    100,
    10,
    1000 + pnl,
    (1000 + pnl) / 10,
    0,
    0,
    0,
    0,
    0,
    pnl,
    0,
    0,
    pnl,
  ];
  const totals: unknown[] = Array(24).fill('');
  totals[2] = 'Totals';
  totals[10] = 1000;
  totals[13] = 1000 + pnl;
  totals[20] = pnl;
  totals[23] = pnl;
  const summary = (label: string, amount: number) => {
    const r: unknown[] = Array(24).fill('');
    r[17] = label;
    r[23] = amount;
    return r;
  };
  return [
    ['', '', '', '', 'FINVASIA SECURITIES PRIVATE LIMITED'],
    ['', '', '', '', 'Derivative PL Statement From  01/04/2026 To  15/10/2026'],
    ['', '', '', '', 'Account ID SYNTHETIC TEST ONLY'],
    [...header],
    row,
    totals,
    summary('Total Future MTM', 0),
    summary('Total Option MTM', pnl),
    summary('Total Option Premium', pnl),
    summary('Brokerage', 5),
    summary('Sebi Charges', 1),
    summary('Security Transaction Tax', 2),
    summary('Transaction Charges', 1),
    summary('IGST', 1),
    summary('Net Total As Per Ledger', pnl - 10),
    summary('Net MTM Total', pnl - 10),
    ['Disclaimer :- Reconcile the statement with contract notes.'],
  ];
}
function workbook(rows = fixture()) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Derivative PL Statement');
  return wb;
}
function parsed(loss = false) {
  const r = detectShoonyaFno(workbook(fixture(loss)), 'DerivativePLStatement.xlsx');
  if (!r.detected || !r.statement) throw new Error(r.detected ? r.error : 'not detected');
  return r.statement;
}

describe('Shoonya F&O Excel', () => {
  it('recognizes the actual report layout, reconciles charges, and does not count MTM/premium twice', () => {
    const r = parsed();
    expect(r.grossPnl).toBe(100);
    expect(r.totalCharges).toBe(10);
    expect(r.netPnl).toBe(90);
    expect(r.financialYear).toBe('2026-27');
    expect(r.records).toBe(1);
    expect(r.warnings.some((w) => w.includes('part-year'))).toBe(true);
    expect(JSON.stringify(r)).not.toContain('SYNTHETIC TEST ONLY');
  });
  it('routes the ordinary broker parser away from equity gains', () => {
    const result = parseWorkbookData(workbook(), 'DerivativePLStatement.xlsx');
    expect(result.success).toBe(false);
    expect(result.derivative?.netPnl).toBe(90);
    expect(result.stcg111A).toBe(0);
    expect(result.ltcg112A).toBe(0);
  });
  it('uploads XLSX bytes through the same File API used in the UI', async () => {
    const bytes = XLSX.write(workbook(), { type: 'array', bookType: 'xlsx' });
    const result = await parseBrokerFile(new File([bytes], 'DerivativePLStatement.xlsx'));
    expect(result.derivative?.netPnl).toBe(90);
  });
  it('uses the existing business-profit engine only after confirmation, preserving unrelated fields', () => {
    const input = emptyInput();
    input.salary.basic = 1500000;
    input.payments.tds = 25000;
    input.business = 500;
    expect(() => prepareFnoImport(parsed(), input, false)).toThrow('Confirm');
    const result = prepareFnoImport(parsed(), input, true);
    expect(result.input.business).toBe(90);
    expect(input.business).toBe(500);
    expect(result.input.salary).toEqual(input.salary);
    expect(result.input.gains).toEqual(input.gains);
    expect(result.input.payments).toEqual(input.payments);
    expect(calculateFinalTax(result.input).ok).toBe(true);
  });
  it('keeps a signed loss, preserves existing business profit, and blocks the tax estimate', () => {
    const s = parsed(true),
      input = emptyInput();
    input.business = 500;
    input.salary.basic = 1500000;
    const r = prepareFnoImport(s, input, false);
    expect(s.netPnl).toBe(-110);
    expect(r.reviewRequired).toBe(true);
    expect(r.input.business).toBe(500);
    expect(r.input.unsupported.losses).toBe(true);
    expect(calculateFinalTax(r.input).ok).toBe(false);
    expect(r.input.salary.basic).toBe(1500000);
  });
  it('replaces a previous result rather than accumulating repeat imports', () => {
    const first = prepareFnoImport(parsed(), emptyInput(), true);
    const next = prepareFnoImport(parsed(), first.input, true);
    expect(next.input.business).toBe(90);
    expect(parsed().fingerprint).toBe(parsed().fingerprint);
  });
  it('rejects FY mismatches', () => {
    const input = emptyInput();
    input.year = '2025-26';
    expect(() => prepareFnoImport(parsed(), input, true)).toThrow('FY 2026-27');
  });
  it.each([
    [
      'invalid period',
      (r: unknown[][]) => {
        r[1][4] = 'Derivative PL Statement From 31/02/2026 To 15/10/2026';
      },
    ],
    [
      'cross-FY period',
      (r: unknown[][]) => {
        r[1][4] = 'Derivative PL Statement From 01/03/2026 To 15/10/2026';
      },
    ],
    [
      'wrong totals',
      (r: unknown[][]) => {
        r[5][23] = 101;
      },
    ],
    [
      'wrong ledger',
      (r: unknown[][]) => {
        r[14][23] = 200;
      },
    ],
    [
      'missing charges',
      (r: unknown[][]) => {
        r.splice(9, 1);
      },
    ],
    [
      'unknown charge',
      (r: unknown[][]) => {
        r[9][17] = 'Mystery charge';
      },
    ],
    [
      'non-numeric P&L',
      (r: unknown[][]) => {
        r[4][23] = 'unavailable';
      },
    ],
    [
      'duplicate summary',
      (r: unknown[][]) => {
        r.push([...r[9]]);
      },
    ],
    [
      'wrong segment',
      (r: unknown[][]) => {
        r[4][1] = 'CASH';
      },
    ],
    [
      'missing PNL',
      (r: unknown[][]) => {
        r[3][23] = 'Other';
      },
    ],
  ])('rejects %s without falling back to equity parsing', (_, mutate) => {
    const rows: unknown[][] = fixture();
    mutate(rows);
    const result = parseWorkbookData(workbook(rows), 'DerivativePLStatement.xlsx');
    expect(result.success).toBe(false);
    expect(result.derivative).toBeUndefined();
    expect(result.error).toBeTruthy();
  });
  it('requires review for open positions and brought-forward amounts', () => {
    const rows = fixture();
    rows[4][19] = 10;
    rows[4][7] = 5;
    const result = detectShoonyaFno(workbook(rows), 'report.xlsx');
    expect(result.detected && result.statement?.reviewReasons.length).toBe(2);
  });
  it('accepts expired zero-valued close quantities without treating them as open positions', () => {
    const rows = fixture();
    rows[4][15] = -10;
    rows[4][4] = '07/04/2026';
    const result = detectShoonyaFno(workbook(rows), 'report.xlsx');
    expect(result.detected && result.statement?.reviewReasons).toEqual([]);
  });
  it('does not change ordinary equity uploads', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Shoonya'], ['STCG', 500], ['LTCG', 1000]]),
      'Summary',
    );
    expect(parseWorkbookData(wb, 'Shoonya.xlsx').success).toBe(true);
  });
});
