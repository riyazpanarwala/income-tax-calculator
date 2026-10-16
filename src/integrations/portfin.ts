import type { Gain, Issue, TaxInput } from '../tax-engine/types';
import { taxYears } from '../tax-rules';
import { validate } from '../tax-engine/validate';
import { add as sum, subtract, multiply, roundPaise } from '../tax-engine/arithmetic';

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
  transferExpenditure?: number;
  gain: number;
  holdingDays: number;
  source: 'fifo';
  grandfathering?: Gain['grandfathering'];
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

const round = roundPaise;

/** Explain the actual blockers instead of suggesting every import failure is a classification error. */
export function portFinReviewIssues(result: Extract<ImportResult, { ok: true }>): Issue[] {
  if (!result.reviewRequired) return [];
  const issues: Issue[] = [];
  for (const warning of result.warnings) {
    const match = /^gains\.(\d+)$/.exec(warning.path);
    if (warning.path === 'portfin' || match) {
      issues.push({
        path: match ? 'PortFin lot review' : 'PortFin source warning',
        message: warning.message,
      });
    }
  }
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const needsGrandfathering = (g: PortFinGain) =>
  g.kind === 'review' &&
  g.reason === 'Grandfathering requires a separately verified cost basis.' &&
  g.acquired < '2018-02-01';

/** Reporting totals include review lots; they are never substituted for verified taxable gains. */
export function portFinReport(data: PortFinExport) {
  const rows = {
    short: { gain: 0, loss: 0 },
    long: { gain: 0, loss: 0 },
    unclassified: { gain: 0, loss: 0 },
  };
  for (const g of data.gains) {
    const term = ['111A', 'otherSTCG'].includes(g.kind)
      ? 'short'
      : ['112A', '112', 'otherLTCG'].includes(g.kind) || needsGrandfathering(g)
        ? 'long'
        : 'unclassified';
    const field = g.gain < 0 ? 'loss' : 'gain';
    rows[term][field] = sum(rows[term][field], Math.abs(g.gain));
  }
  return Object.entries(rows).map(([term, b]) => ({ term, ...b, net: subtract(b.gain, b.loss) }));
}

export function resolveGrandfathering(
  data: PortFinExport,
  symbol: string,
  fmvPerUnit: number,
  source: string,
  eligible: boolean,
  isin?: string,
): PortFinExport {
  if (
    !eligible ||
    !source.trim() ||
    source.length > 2000 ||
    !Number.isFinite(fmvPerUnit) ||
    fmvPerUnit < 0 ||
    fmvPerUnit > 1e12
  )
    throw new Error(
      'Enter the verified 31 January 2018 FMV per unit and its source, and confirm equity / STT eligibility.',
    );
  const next = structuredClone(data);
  const matches = next.gains.filter(
    (g) =>
      g.instrument.symbol === symbol &&
      needsGrandfathering(g) &&
      (!isin ||
        (g.instrument.isin.trim().toUpperCase() === isin &&
          g.instrument.exchange.trim().toUpperCase() === 'AMFI')),
  );
  if (!matches.length) throw new Error('No grandfathering review lots found for this instrument.');
  for (const g of matches) {
    const fairMarketValue = round(multiply(g.quantity, fmvPerUnit));
    const originalCost = g.costBasis;
    g.grandfathering = {
      originalCost,
      fairMarketValue,
      saleProceeds: g.saleProceeds,
      expenses: g.transferExpenditure ?? 0,
      source: source.trim(),
    };
    g.costBasis = Math.max(originalCost, Math.min(fairMarketValue, g.saleProceeds));
    g.gain = subtract(g.saleProceeds, g.costBasis, g.transferExpenditure ?? 0);
    g.kind = '112A';
    g.asset = 'equity';
    g.confirmed = true;
    g.reason = '';
  }
  Object.values(next.summary).forEach((b) => {
    b.gain = 0;
    b.loss = 0;
  });
  for (const g of next.gains) {
    const bucket = next.summary[bucketFor(g.kind)],
      field = g.gain < 0 ? 'loss' : 'gain';
    bucket[field] = sum(bucket[field], Math.abs(g.gain));
  }
  next.reconciliation.reviewCount = next.gains.filter(
    (g) => g.kind === 'review' || g.gain < 0,
  ).length;
  next.reconciliation.totalGain = sum(...next.gains.map((g) => g.gain));
  return next;
}

export function portFinReviewRecords(result: Extract<ImportResult, { ok: true }>) {
  return result.warnings.flatMap((warning) => {
    const match = /^gains\.(\d+)$/.exec(warning.path);
    const gain = match && result.data.gains[Number(match[1])];
    return gain ? [{ gain, reason: warning.message }] : [];
  });
}

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
  JSON.stringify([
    g.kind,
    g.asset,
    g.amount,
    g.acquired,
    g.sold,
    g.confirmed,
    g.grandfathering ?? null,
  ]);

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
      Object.entries(fields).forEach(([k, t]) => {
        // Older v1 exports predate the optional, separately itemised sale expenses.
        if (
          ['transferExpenditure', 'grandfathering'].includes(k) &&
          /^portfin\.gains\.\d+$/.test(path) &&
          !Object.hasOwn(obj, k)
        )
          return;
        shape(obj[k], t, `${path}.${k}`);
      });
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
          transferExpenditure: 0,
          gain: 0,
          holdingDays: 0,
          source: '',
          grandfathering: {
            originalCost: 0,
            fairMarketValue: 0,
            saleProceeds: 0,
            expenses: 0,
            source: '',
          },
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
      (g.transferExpenditure ?? 0) < 0 ||
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
      [g.gain, g.saleProceeds, g.costBasis, g.transferExpenditure ?? 0].some(
        (n) => round(n) !== n,
      ) ||
      Math.abs(round(g.saleProceeds - g.costBasis - (g.transferExpenditure ?? 0) - g.gain)) > 0.01
    )
      add(p, 'Gain and rounded proceeds, cost and transfer expenditure do not reconcile.');
    if (g.kind === 'review' && (g.confirmed || !g.reason.trim()))
      add(p, 'Review records must be unconfirmed and include a reason.');
    if (g.grandfathering) {
      const b = g.grandfathering;
      if (
        [b.originalCost, b.fairMarketValue, b.saleProceeds, b.expenses].some(
          (n) => n < 0 || round(n) !== n,
        ) ||
        g.costBasis !== Math.max(b.originalCost, Math.min(b.fairMarketValue, b.saleProceeds)) ||
        b.saleProceeds !== g.saleProceeds ||
        b.expenses !== (g.transferExpenditure ?? 0)
      )
        add(
          p,
          'Grandfathering inputs do not reconcile with the exported cost, proceeds and expenses.',
        );
    }
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
  let unsupported = d.warnings.length > 0;
  d.gains.forEach((g, i) => {
    const mapped: Gain | null =
      g.kind === 'review'
        ? null
        : {
            kind: g.kind,
            asset: g.asset,
            amount: g.gain,
            acquired: g.acquired,
            sold: g.sold,
            confirmed: g.confirmed,
            ...(g.grandfathering ? { grandfathering: g.grandfathering } : {}),
          };
    const issues = mapped
      ? validate({ ...currentTaxInput, gains: [mapped] }, taxYears[currentTaxInput.year]).filter(
          (issue) => issue.path.startsWith('gains.'),
        )
      : [];
    if (!mapped || issues.length || !g.confirmed) {
      reviewCount++;
      if (!mapped || issues.length || !g.confirmed) unsupported = true;
      warnings.push({
        path: `gains.${i}`,
        message: `${g.instrument.symbol}: ${[g.reason, ...issues.map((x) => x.message)].filter(Boolean).join(' ') || 'Classification needs confirmation.'}`,
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
          g.transferExpenditure ?? 0,
          g.gain,
          g.kind,
          g.asset,
          g.confirmed,
          g.reason,
          g.grandfathering ?? null,
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
  const allocationIssues = validate(
    { ...currentTaxInput, gains: next },
    taxYears[currentTaxInput.year],
  ).filter((issue) => issue.path === 'gains');
  if (allocationIssues.length) {
    unsupported = true;
    warnings.push(
      ...allocationIssues.map((issue) => ({ path: 'portfin', message: issue.message })),
    );
  }
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
    reviewRequired: unsupported,
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
            otherSpecial: currentTaxInput.unsupported.otherSpecial || unsupported,
          },
        },
  };
}
