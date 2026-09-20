import type { Gain, Issue, TaxInput } from '../tax-engine/types';
import { taxYears } from '../tax-rules';
import { validate } from '../tax-engine/validate';

type Bucket = { gain: number; loss: number };
export interface PortFinGain {
  id: string;
  transaction: string;
  kind: Gain['kind'] | 'review';
  asset: Gain['asset'];
  confirmed: boolean;
  reason: string;
  instrument: { symbol: string; name: string; isin: string; exchange: string };
  acquired: string;
  sold: string;
  quantity: number;
  saleProceeds: number;
  costBasis: number;
  gain: number;
  holdingDays: number;
  source: 'fifo';
}
export interface PortFinExport {
  schemaVersion: 1;
  source: 'portfin';
  financialYear: string;
  generatedAt: string;
  summary: Record<'section111A' | 'section112A' | 'otherSTCG' | 'otherLTCG' | 'review', Bucket>;
  gains: PortFinGain[];
  warnings: string[];
  reconciliation: {
    transactionCount: number;
    gainCount: number;
    reviewCount: number;
    totalGain: number;
  };
}
export type ImportResult =
  | { ok: false; errors: Issue[] }
  | {
      ok: true;
      input: TaxInput;
      data: PortFinExport;
      warnings: Issue[];
      reviewRequired: boolean;
      reviewCount: number;
      importedCount: number;
      fingerprint: string;
      duplicate: boolean;
    };

const round = (n: number) => Number(n.toFixed(2));
const dateValid = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const bucketFor = (kind: PortFinGain['kind']): keyof PortFinExport['summary'] =>
  kind === '111A'
    ? 'section111A'
    : kind === '112A'
      ? 'section112A'
      : kind === '112' || kind === 'otherLTCG'
        ? 'otherLTCG'
        : kind;

// Canonical serialized values are collision-free fingerprints; no account/database IDs.
export const gainFingerprint = (g: Gain) =>
  JSON.stringify([g.kind, g.asset, g.amount, g.acquired, g.sold, g.confirmed]);

export function parsePortFinJson(text: string): unknown {
  if (text.length > 5_000_000) throw new Error('PortFin file exceeds the 5 MB limit.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
}

export function importPortFinTaxData(
  data: unknown,
  currentTaxInput: TaxInput,
  options: { mode?: 'replace' | 'merge'; previousFingerprint?: string } = {},
): ImportResult {
  const errors: Issue[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });
  function shape(value: unknown, template: unknown, path: string): void {
    if (Array.isArray(template)) {
      if (!Array.isArray(value) || value.length > 10000) {
        add(path, 'Expected a list of at most 10,000 items.');
        return;
      }
      value.forEach((v, i) => shape(v, template[0], `${path}.${i}`));
    } else if (template !== null && typeof template === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        add(path, 'Expected an object.');
        return;
      }
      const obj = value as Record<string, unknown>;
      const fields = template as Record<string, unknown>;
      Object.keys(obj)
        .filter((k) => !Object.hasOwn(fields, k))
        .forEach((k) => add(`${path}.${k}`, 'Unknown field.'));
      Object.entries(fields).forEach(([k, t]) => shape(obj[k], t, `${path}.${k}`));
    } else if (
      typeof value !== typeof template ||
      (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e12)) ||
      (typeof value === 'string' && value.length > 2000)
    ) {
      add(path, 'Missing or invalid value.');
    }
  }
  const bucket = { gain: 0, loss: 0 };
  shape(
    data,
    {
      schemaVersion: 0,
      source: '',
      financialYear: '',
      generatedAt: '',
      summary: {
        section111A: bucket,
        section112A: bucket,
        otherSTCG: bucket,
        otherLTCG: bucket,
        review: bucket,
      },
      gains: [
        {
          id: '',
          transaction: '',
          kind: '',
          asset: '',
          confirmed: false,
          reason: '',
          instrument: { symbol: '', name: '', isin: '', exchange: '' },
          acquired: '',
          sold: '',
          quantity: 0,
          saleProceeds: 0,
          costBasis: 0,
          gain: 0,
          holdingDays: 0,
          source: '',
        },
      ],
      warnings: [''],
      reconciliation: { transactionCount: 0, gainCount: 0, reviewCount: 0, totalGain: 0 },
    },
    'portfin',
  );
  if (errors.length) return { ok: false, errors };
  const d = data as PortFinExport;
  if (d.schemaVersion !== 1) add('schemaVersion', 'Unsupported PortFin schemaVersion. Expected 1.');
  if (d.source !== 'portfin') add('source', 'Expected source portfin.');
  if (
    !/^\d{4}-\d{2}$/.test(d.financialYear) ||
    String(Number(d.financialYear.slice(0, 4)) + 1).slice(-2) !== d.financialYear.slice(-2)
  )
    add('financialYear', 'Invalid financial year.');
  if (d.financialYear !== currentTaxInput.year)
    add(
      'financialYear',
      `The PortFin export is for FY ${d.financialYear}, but this calculator is currently set to FY ${currentTaxInput.year}.`,
    );
  if (!taxYears[currentTaxInput.year])
    add('financialYear', 'This calculator has no rules for the selected FY.');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(d.generatedAt) ||
    !Number.isFinite(Date.parse(d.generatedAt)) ||
    new Date(d.generatedAt).toISOString() !== d.generatedAt
  )
    add('generatedAt', 'Invalid generation timestamp.');
  const year = Number(d.financialYear.slice(0, 4));
  const ids = new Set<string>();
  const totals = structuredClone(d.summary);
  Object.values(totals).forEach((b) => {
    b.gain = 0;
    b.loss = 0;
  });
  d.gains.forEach((g, i) => {
    const p = `gains.${i}`;
    if (!g.id || ids.has(g.id)) add(p, 'Missing or duplicate lot ID.');
    ids.add(g.id);
    if (!g.transaction || !g.instrument.symbol)
      add(p, 'Transaction and instrument identifiers are required.');
    if (!['111A', '112A', '112', 'otherSTCG', 'otherLTCG', 'review'].includes(g.kind))
      add(p, 'Invalid gain category.');
    else {
      const b = totals[bucketFor(g.kind)];
      const key = g.gain < 0 ? 'loss' : 'gain';
      b[key] = round(b[key] + Math.abs(g.gain));
    }
    if (!['equity', 'property', 'other'].includes(g.asset) || g.source !== 'fifo')
      add(p, 'Invalid asset or gain source.');
    if (
      !dateValid(g.acquired) ||
      !dateValid(g.sold) ||
      g.acquired > g.sold ||
      g.sold < `${year}-04-01` ||
      g.sold > `${year + 1}-03-31`
    )
      add(p, 'Invalid dates or sale outside the export FY.');
    if (
      g.quantity <= 0 ||
      g.saleProceeds < 0 ||
      g.costBasis < 0 ||
      !Number.isInteger(g.holdingDays) ||
      g.holdingDays < 0
    )
      add(p, 'Invalid quantity, cost, proceeds or holding days.');
    if (
      dateValid(g.acquired) &&
      dateValid(g.sold) &&
      g.holdingDays !== Math.round((Date.parse(g.sold) - Date.parse(g.acquired)) / 86400000)
    )
      add(p, 'Holding days do not reconcile with dates.');
    if (
      [g.gain, g.saleProceeds, g.costBasis].some((n) => round(n) !== n) ||
      Math.abs(round(g.saleProceeds - g.costBasis - g.gain)) > 0.01
    )
      add(p, 'Gain and rounded cost/proceeds do not reconcile.');
    if (g.kind === 'review' && (g.confirmed || !g.reason.trim()))
      add(p, 'Review records must be unconfirmed and include a reason.');
  });
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
    if (totals[k].gain !== d.summary[k].gain || totals[k].loss !== d.summary[k].loss)
      add(`summary.${k}`, 'Summary does not reconcile with lots.');
  }
  const r = d.reconciliation;
  if (
    r.gainCount !== d.gains.length ||
    r.transactionCount !== new Set(d.gains.map((g) => g.transaction)).size ||
    r.reviewCount !== d.gains.filter((g) => g.kind === 'review' || g.gain < 0).length ||
    r.totalGain !== round(d.gains.reduce((sum, g) => sum + g.gain, 0))
  )
    add('reconciliation', 'Counts or total do not reconcile with lots.');
  if (errors.length) return { ok: false, errors };

  const warnings: Issue[] = d.warnings.map((message) => ({ path: 'portfin', message }));
  const gains: Gain[] = [];
  let reviewCount = 0;
  let loss = false;
  let unsupported = d.warnings.length > 0;
  d.gains.forEach((g, i) => {
    if (g.gain < 0) loss = true;
    const mapped: Gain | null =
      g.kind === 'review'
        ? null
        : {
            kind: g.kind,
            asset: g.asset,
            amount: Math.max(0, g.gain),
            acquired: g.acquired,
            sold: g.sold,
            confirmed: g.confirmed,
          };
    const issues = mapped
      ? validate({ ...currentTaxInput, gains: [mapped] }, taxYears[currentTaxInput.year]).filter(
          (issue) => issue.path.startsWith('gains.'),
        )
      : [];
    if (!mapped || g.gain < 0 || issues.length || !g.confirmed) {
      reviewCount++;
      if (!mapped || issues.length || !g.confirmed) unsupported = true;
      warnings.push({
        path: `gains.${i}`,
        message:
          g.gain < 0
            ? `${g.instrument.symbol}: capital loss ${g.gain}; loss set-off is unsupported and the estimate is withheld.`
            : `${g.instrument.symbol}: ${g.reason || issues.map((x) => x.message).join(' ') || 'Classification needs confirmation.'}`,
      });
    } else gains.push(mapped);
  });
  const fingerprint = JSON.stringify([
    d.financialYear,
    d.gains
      .map((g) =>
        JSON.stringify([
          g.instrument.symbol,
          g.instrument.isin,
          g.instrument.exchange,
          g.acquired,
          g.sold,
          g.quantity,
          g.costBasis,
          g.saleProceeds,
          g.gain,
          g.kind,
          g.asset,
          g.confirmed,
          g.reason,
        ]),
      )
      .sort(),
    [...d.warnings].sort(),
  ]);
  const duplicate = options.previousFingerprint === fingerprint;
  if (options.mode === 'merge' && options.previousFingerprint && !duplicate)
    return {
      ok: false,
      errors: [
        {
          path: 'gains',
          message: 'An earlier PortFin import exists. Replace capital gains to update it safely.',
        },
      ],
    };
  let next = gains;
  if (options.mode === 'merge') {
    const available = currentTaxInput.gains.map(gainFingerprint);
    next = [...currentTaxInput.gains];
    for (const g of gains) {
      const index = available.indexOf(gainFingerprint(g));
      if (index >= 0) {
        available.splice(index, 1);
        warnings.push({
          path: 'gains',
          message:
            'An identical existing gain was retained instead of duplicated. Verify transaction overlap.',
        });
      } else next.push(g);
    }
  }
  if (next.length > 100)
    return {
      ok: false,
      errors: [
        {
          path: 'gains',
          message:
            'The calculator supports at most 100 gains. This import needs separate review; no rows were dropped.',
        },
      ],
    };
  if (currentTaxInput.gains.length)
    warnings.unshift({
      path: 'gains',
      message:
        'You already have capital gains entered. Importing PortFin data may duplicate some transactions. Replace is recommended; merge only after reviewing broker/manual overlap.',
    });
  return {
    ok: true,
    data: d,
    warnings,
    reviewCount,
    reviewRequired: loss || unsupported,
    importedCount: gains.length,
    fingerprint,
    duplicate,
    input: duplicate
      ? currentTaxInput
      : {
          ...currentTaxInput,
          gains: next,
          unsupported: {
            ...currentTaxInput.unsupported,
            losses: currentTaxInput.unsupported.losses || loss,
            otherSpecial: currentTaxInput.unsupported.otherSpecial || unsupported,
          },
        },
  };
}
