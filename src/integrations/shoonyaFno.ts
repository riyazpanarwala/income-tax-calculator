import * as XLSX from 'xlsx';
import type { TaxInput } from '../tax-engine/types';

export interface ShoonyaFnoStatement {
  fileName: string;
  financialYear: string;
  from: string;
  to: string;
  records: number;
  grossPnl: number;
  charges: { label: string; amount: number }[];
  totalCharges: number;
  netPnl: number;
  warnings: string[];
  reviewReasons: string[];
  fingerprint: string;
}
export type FnoDetection =
  { detected: false } | { detected: true; statement?: ShoonyaFnoStatement; error?: string };
const round = (n: number) => Number(n.toFixed(2));
const text = (v: unknown) => String(v ?? '').trim();
const normalized = (v: unknown) => text(v).toLowerCase().replace(/\s+/g, ' ');
function number(v: unknown, label: string): number {
  const cleaned =
    typeof v === 'string'
      ? v
          .trim()
          .replace(/[₹,\s]/g, '')
          .replace(/^\((.*)\)$/, '-$1')
      : v;
  if (
    cleaned === '' ||
    (typeof cleaned !== 'number' && typeof cleaned !== 'string') ||
    !Number.isFinite(Number(cleaned)) ||
    Math.abs(Number(cleaned)) > 1e12
  )
    throw new Error(`Missing or invalid ${label}.`);
  return Number(cleaned);
}
function date(value: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!m) throw new Error('Invalid statement date. Expected DD/MM/YYYY.');
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso)
    throw new Error('Invalid statement date.');
  return iso;
}
const fy = (iso: string) => {
  const start = Number(iso.slice(0, 4)) - (iso.slice(5, 7) < '04' ? 1 : 0);
  return `${start}-${String(start + 1).slice(-2)}`;
};

/** Detect this report before the generic equity parser. Never extract account identifiers. */
export function detectShoonyaFno(workbook: XLSX.WorkBook, fileName: string): FnoDetection {
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      defval: '',
      blankrows: false,
    }),
  }));
  const candidates = sheets.filter((s) =>
    /derivative\s*p\s*&?\s*l\s*statement/i.test(s.name + ' ' + s.rows.slice(0, 8).flat().join(' ')),
  );
  if (!candidates.length) return { detected: false };
  try {
    if (candidates.length !== 1 || sheets.some((s) => !candidates.includes(s) && s.rows.length))
      throw new Error('Upload a standalone Shoonya derivative statement with one report sheet.');
    const rows = candidates[0].rows;
    if (!/finvasia|shoonya/i.test(rows.slice(0, 8).flat().join(' ')))
      throw new Error(
        'This derivative layout is supported only for Shoonya / Finvasia statements.',
      );
    const periods = rows
      .flat()
      .map(text)
      .filter((s) => /Derivative\s+PL\s+Statement\s+From/i.test(s));
    const period =
      periods.length === 1 &&
      /From\s+(\d{2}\/\d{2}\/\d{4})\s+To\s+(\d{2}\/\d{2}\/\d{4})/i.exec(periods[0]);
    if (!period) throw new Error('The report must include an unambiguous From / To period.');
    const from = date(period[1]),
      to = date(period[2]);
    if (from > to || fy(from) !== fy(to))
      throw new Error('The report period must be within one financial year.');
    const headers = rows
      .map((r, i) =>
        r.some((v) => normalized(v) === 'instrument') && r.some((v) => normalized(v) === 'pnl')
          ? i
          : -1,
      )
      .filter((i) => i >= 0);
    if (headers.length !== 1) throw new Error('Expected one derivative contract table.');
    const headerIndex = headers[0],
      header = rows[headerIndex].map(normalized);
    const col = (name: string) => {
      const i = header.indexOf(name);
      if (i < 0 || header.lastIndexOf(name) !== i)
        throw new Error(`Missing or duplicate ${name} column.`);
      return i;
    };
    const fields = [
      'exchange',
      'segment',
      'instrument',
      'symbol',
      'expiry date',
      'strike price',
      'option type',
      'bf quantity',
      'bf value',
      'buy quantity',
      'buy value',
      'sell quantity',
      'sell value',
      'cl quantity',
      'cl value',
      'ca quantity',
      'ca value',
      'net quantity',
      'net value',
      'pnl',
    ];
    const columns = Object.fromEntries(fields.map((f) => [f, col(f)]));
    const totalsIndexes = rows
      .map((r, i) => (i > headerIndex && normalized(r[columns.instrument]) === 'totals' ? i : -1))
      .filter((i) => i >= 0);
    if (totalsIndexes.length !== 1) throw new Error('Missing or duplicate Totals row.');
    const totalsIndex = totalsIndexes[0];
    const trades = rows.slice(headerIndex + 1, totalsIndex).filter((r) => r.some((v) => text(v)));
    if (!trades.length || trades.length > 10000)
      throw new Error('Expected 1–10,000 derivative contract rows.');
    const review = new Set<string>();
    const numeric = fields.filter(
      (f) =>
        !['exchange', 'segment', 'instrument', 'symbol', 'expiry date', 'option type'].includes(f),
    );
    const records = trades.map((r, i) => {
      if (
        !['NSE', 'BSE'].includes(text(r[columns.exchange]).toUpperCase()) ||
        text(r[columns.segment]).toUpperCase() !== 'FNO' ||
        !['OPTIDX', 'OPTSTK', 'FUTIDX', 'FUTSTK'].includes(
          text(r[columns.instrument]).toUpperCase(),
        ) ||
        !text(r[columns.symbol])
      )
        throw new Error(`Unsupported derivative contract at row ${i + 1}.`);
      const expiry = date(text(r[columns['expiry date']]));
      const values = Object.fromEntries(
        numeric.map((f) => [f, number(r[columns[f]], `row ${i + 1} ${f}`)]),
      );
      if (['buy quantity', 'sell quantity', 'buy value', 'sell value'].some((f) => values[f] < 0))
        throw new Error('Negative buy/sell quantities or values require a corrected statement.');
      if (
        values['bf quantity'] ||
        values['bf value'] ||
        values['ca quantity'] ||
        values['ca value']
      )
        review.add(
          'Brought-forward or corporate-action amounts need reconciliation with contract notes.',
        );
      if (values['net quantity'] || values['cl value'] || (values['cl quantity'] && expiry > to))
        review.add('Open positions or closing valuations may include unrealized P&L.');
      return {
        contract: [
          r[columns.exchange],
          r[columns.instrument],
          r[columns.symbol],
          expiry,
          r[columns['option type']],
        ],
        values,
      };
    });
    const totals = rows[totalsIndex];
    for (const key of ['buy value', 'sell value', 'net value', 'pnl']) {
      if (
        Math.abs(
          round(records.reduce((sum, r) => sum + r.values[key], 0)) -
            number(totals[columns[key]], `total ${key}`),
        ) > 0.02
      )
        throw new Error(`Contract rows do not reconcile with total ${key}.`);
    }
    const summary = new Map<string, number>();
    for (const row of rows.slice(totalsIndex + 1)) {
      const populated = row.map((v, i) => ({ v, i })).filter((x) => text(x.v));
      if (
        !populated.length ||
        /^disclaimer|broker\(s\)|before the report date|provided to you/i.test(text(populated[0].v))
      )
        continue;
      if (populated.length !== 2)
        throw new Error('Unexpected summary row; upload the original Shoonya report.');
      const label = normalized(populated[0].v);
      if (summary.has(label)) throw new Error(`Duplicate summary: ${label}.`);
      summary.set(label, number(populated[1].v, label));
    }
    const chargeLabels = [
      'brokerage',
      'sebi charges',
      'security transaction tax',
      'transaction charges',
      'igst',
      'cgst',
      'sgst',
      'stamp duty',
    ];
    const summaryLabels = [
      'total future mtm',
      'total option mtm',
      'total option premium',
      'net total as per ledger',
      'net mtm total',
    ];
    for (const label of summary.keys())
      if (![...chargeLabels, ...summaryLabels].includes(label))
        throw new Error(`Unrecognised summary amount: ${label}.`);
    for (const required of [...summaryLabels, ...chargeLabels.slice(0, 4)])
      if (!summary.has(required)) throw new Error(`Missing ${required}.`);
    if (!summary.has('igst') && !(summary.has('cgst') && summary.has('sgst')))
      throw new Error('Missing GST charges.');
    const charges = chargeLabels
      .filter((label) => summary.has(label))
      .map((label) => ({ label, amount: summary.get(label)! }));
    if (charges.some((c) => c.amount < 0))
      throw new Error('Negative charges require review of a corrected statement.');
    const grossPnl = round(number(totals[columns.pnl], 'total PNL'));
    const totalCharges = round(charges.reduce((sum, c) => sum + c.amount, 0));
    const netPnl = round(summary.get('net total as per ledger')!);
    if (
      Math.abs(round(grossPnl - totalCharges) - netPnl) > 0.02 ||
      Math.abs(summary.get('net mtm total')! - netPnl) > 0.02 ||
      Math.abs(
        round(summary.get('total future mtm')! + summary.get('total option mtm')!) - grossPnl,
      ) > 0.02
    )
      throw new Error('P&L, charges and net ledger totals do not reconcile.');
    if (netPnl < 0)
      review.add(
        'This statement has a net F&O loss. Business-loss set-off and carry-forward are not supported; the estimate will be withheld.',
      );
    const financialYear = fy(from);
    const warnings = [
      'Broker P&L is not automatically final taxable business profit. Verify contract notes, eligible expenses and tax adjustments.',
    ];
    if (
      from !== `${financialYear.slice(0, 4)}-04-01` ||
      to !== `${Number(financialYear.slice(0, 4)) + 1}-03-31`
    )
      warnings.push('This is a part-year statement. It is not a complete annual F&O result.');
    return {
      detected: true,
      statement: {
        fileName,
        financialYear,
        from,
        to,
        records: trades.length,
        grossPnl,
        charges,
        totalCharges,
        netPnl,
        warnings,
        reviewReasons: [...review],
        fingerprint: JSON.stringify([
          from,
          to,
          records.map((r) => JSON.stringify(r)).sort(),
          charges,
          netPnl,
        ]),
      },
    };
  } catch (error) {
    return {
      detected: true,
      error: error instanceof Error ? error.message : 'Invalid Shoonya derivative statement.',
    };
  }
}

export function prepareFnoImport(
  statement: ShoonyaFnoStatement,
  current: TaxInput,
  confirmed: boolean,
) {
  if (statement.financialYear !== current.year)
    throw new Error(
      `The statement is for FY ${statement.financialYear}, but the calculator is set to FY ${current.year}.`,
    );
  const reviewRequired = statement.reviewReasons.length > 0;
  if (!reviewRequired && !confirmed)
    throw new Error(
      'Confirm that the statement net profit is the reconciled taxable business profit for this estimate.',
    );
  return {
    reviewRequired,
    input: reviewRequired
      ? {
          ...current,
          unsupported: {
            ...current.unsupported,
            losses: current.unsupported.losses || statement.netPnl < 0,
            otherSpecial:
              current.unsupported.otherSpecial ||
              statement.reviewReasons.some(
                (r) => !r.startsWith('This statement has a net F&O loss.'),
              ),
          },
        }
      : { ...current, business: statement.netPnl },
  };
}
