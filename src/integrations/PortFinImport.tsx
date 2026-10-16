import { useRef, useState } from 'react';
import type { TaxInput, Gain } from '../tax-engine/types';
import {
  importPortFinTaxData,
  parsePortFinJson,
  portFinReviewIssues,
  portFinReviewRecords,
  portFinReport,
  needsGrandfathering,
  resolveGrandfathering,
  type PortFinExport,
  type ImportResult,
} from './portfin';
import { money } from '../format';
import { calculateCapitalGains } from '../tax-engine/calculateCapitalGains';
import { applyAmfiNav, loadAmfiNav, AMFI_2018_SOURCE, type AutomaticNav } from './amfiNav';

export interface PortFinSession {
  previous?: TaxInput;
  accepted?: Extract<ImportResult, { ok: true }>;
  original?: PortFinExport;
  automaticNavs?: AutomaticNav[];
}

function AutomaticNavNotice({ entries }: { entries: AutomaticNav[] }) {
  if (!entries.length) return null;
  return (
    <section aria-label="Automatic historical NAV lookup">
      <p>
        31 January 2018 NAVs matched automatically from{' '}
        <a href={AMFI_2018_SOURCE} target="_blank" rel="noreferrer">
          AMFI's official reference
        </a>
        . Grandfathering costs have been calculated.
      </p>
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.symbol}:${entry.isin}`}>
            {entry.symbol}: NAV per unit ₹
            {entry.nav.toLocaleString('en-IN', { maximumFractionDigits: 10 })} · {entry.isin} ·{' '}
            {entry.lots} lots
          </li>
        ))}
      </ul>
    </section>
  );
}

function PortFinTotals({
  result,
  original,
  currentGains,
}: {
  result: Extract<ImportResult, { ok: true }>;
  original?: PortFinExport;
  currentGains?: Gain[];
}) {
  const setOff = calculateCapitalGains(currentGains ?? result.input.gains);
  const report = original ?? result.data;
  return (
    <section aria-label="PortFin capital gains reconciliation">
      <h3>Complete LTCG / STCG breakdown</h3>
      <div className="table-scroll">
        <table>
          <caption>Original PortFin report: all lots, before tax-cost adjustments</caption>
          <thead>
            <tr>
              <th scope="col">Term</th>
              <th scope="col">Gross gains</th>
              <th scope="col">Losses</th>
              <th scope="col">Net gain / loss</th>
            </tr>
          </thead>
          <tbody>
            {portFinReport(report).map((row) => (
              <tr key={row.term}>
                <td>
                  {row.term === 'short' ? 'STCG' : row.term === 'long' ? 'LTCG' : 'Unclassified'}
                </td>
                <td>{money(row.gain)}</td>
                <td>{money(-row.loss)}</td>
                <td>{money(row.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total signed gain / loss
              </th>
              <td>{money(report.reconciliation.totalGain)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note">
        These are reconciliation totals before annual exemption.{' '}
        {result.data.gains.some(needsGrandfathering)
          ? 'Pending grandfathering lots remain in LTCG for reporting; they cannot enter the tax calculation until their acquisition cost is verified.'
          : 'Tax-cost adjustments and current-year loss set-off are shown separately below.'}
      </p>
      {result.data.gains.some((g) => g.grandfathering) && (
        <>
          <p>
            After verified grandfathering cost adjustments, total signed gain / loss is{' '}
            {money(result.data.reconciliation.totalGain)}. This can differ from the original report
            above.
          </p>
          <details>
            <summary>Verified grandfathering cost inputs</summary>
            <div className="table-scroll">
              <table>
                <caption>Verified tax-cost computation for older lots</caption>
                <thead>
                  <tr>
                    <th scope="col">Instrument</th>
                    <th scope="col">Original cost</th>
                    <th scope="col">FMV (lot total)</th>
                    <th scope="col">Adjusted cost</th>
                    <th scope="col">Gain / loss</th>
                    <th scope="col">FMV source</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.gains
                    .filter((g) => g.grandfathering)
                    .map((g) => (
                      <tr key={g.id}>
                        <td>
                          {g.instrument.symbol} · {g.acquired}
                        </td>
                        <td>{money(g.grandfathering!.originalCost)}</td>
                        <td>{money(g.grandfathering!.fairMarketValue)}</td>
                        <td>{money(g.costBasis)}</td>
                        <td>{money(g.gain)}</td>
                        <td className="portfin-review-reason">{g.grandfathering!.source}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p>Re-upload the original export to change verified FMV assumptions.</p>
          </details>
        </>
      )}
      {!result.reviewRequired && (
        <>
          <p>
            Current-year equity set-off: LTCL against LTCG {money(setOff.longToLong)}; STCL against
            STCG {money(setOff.shortToShort)}; remaining STCL against LTCG{' '}
            {money(setOff.shortToLong)}.
          </p>
          <p>
            Unabsorbed STCL {money(setOff.remainingShortLoss)}; unabsorbed LTCL{' '}
            {money(setOff.remainingLongLoss)}. No salary or other income is reduced. Carry-forward
            eligibility is not calculated.
          </p>
        </>
      )}
    </section>
  );
}

function GrandfatheringForm({
  data,
  onResolve,
}: {
  data: PortFinExport;
  onResolve: (data: PortFinExport) => void;
}) {
  const symbols = [
    ...new Set(data.gains.filter(needsGrandfathering).map((g) => g.instrument.symbol)),
  ];
  const [values, setValues] = useState<
    Record<string, { fmv: string; source: string; eligible: boolean }>
  >({});
  const [error, setError] = useState('');
  if (!symbols.length) return null;
  return (
    <section aria-label="Verify grandfathering costs" className="repeat-card">
      <h3>Verify older equity / fund acquisition costs</h3>
      <p>
        Automatic lookup could not resolve these lots. Enter verified values below if available.
      </p>
      <p>
        For each instrument, enter the verified fair-market value per unit on 31 January 2018, using
        the same unit basis as the exported quantities. The app uses the higher of original cost and
        the lower of FMV and sale proceeds, then deducts transfer expenses. Use records adjusted for
        any splits or other corporate actions.
      </p>
      {symbols.map((symbol) => {
        const value = values[symbol] ?? { fmv: '', source: '', eligible: false };
        const update = (patch: Partial<typeof value>) =>
          setValues((prev) => ({ ...prev, [symbol]: { ...value, ...patch } }));
        const lots = data.gains.filter(
          (g) => g.instrument.symbol === symbol && needsGrandfathering(g),
        );
        return (
          <fieldset key={symbol} className="repeat-card">
            <legend>
              {symbol} · {lots.length} lots
            </legend>
            <div className="fields">
              <label className="field">
                <span>{symbol} FMV per unit on 31 January 2018</span>
                <input
                  inputMode="decimal"
                  value={value.fmv}
                  onChange={(e) => update({ fmv: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{symbol} FMV source / statement reference</span>
                <input
                  value={value.source}
                  maxLength={2000}
                  onChange={(e) => update({ source: e.target.value })}
                  placeholder="AMC statement or historical NAV reference"
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={value.eligible}
                onChange={(e) => update({ eligible: e.target.checked })}
              />
              <span>
                I verified {symbol}'s equity / equity-oriented-fund and STT eligibility, original
                cost, and the FMV unit basis.
              </span>
            </label>
            <button
              className="secondary"
              disabled={!value.fmv.trim() || !value.source.trim() || !value.eligible}
              onClick={() => {
                try {
                  const amount = Number(value.fmv.replaceAll(',', ''));
                  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.fmv.replaceAll(',', '')))
                    throw new Error('Enter a valid FMV per unit.');
                  onResolve(
                    resolveGrandfathering(data, symbol, amount, value.source, value.eligible),
                  );
                  setError('');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Could not verify cost.');
                }
              }}
            >
              Apply verified cost for {symbol}
            </button>
          </fieldset>
        );
      })}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function PortFinReview({ result }: { result: Extract<ImportResult, { ok: true }> }) {
  const records = portFinReviewRecords(result);
  return (
    <div>
      <ul>
        {portFinReviewIssues(result).map((issue, i) => (
          <li key={i}>{issue.message}</li>
        ))}
      </ul>
      {records.length > 0 && (
        <details>
          <summary>{records.length} lots excluded from the editable capital gains</summary>
          <p>
            These signed amounts remain in the import for review. Losses have not been discarded or
            converted into gains.
          </p>
          <div className="table-scroll">
            <table>
              <caption>PortFin lots requiring review</caption>
              <thead>
                <tr>
                  <th scope="col">Instrument</th>
                  <th scope="col">Acquired</th>
                  <th scope="col">Sold</th>
                  <th scope="col">Export category</th>
                  <th scope="col">Gain / loss</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {records.map(({ gain, reason }) => (
                  <tr key={gain.id}>
                    <td>{gain.instrument.symbol}</td>
                    <td>{gain.acquired}</td>
                    <td>{gain.sold}</td>
                    <td>
                      {gain.kind} / {gain.asset}
                    </td>
                    <td>{money(gain.gain)}</td>
                    <td className="portfin-review-reason">{reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="note">
        Tax categories come from the PortFin export. Check the instrument and tax classification in
        PortFin before exporting again; this importer does not infer equity eligibility from a
        symbol or exchange.
      </p>
    </div>
  );
}
export function PortFinImport({
  input,
  session,
  setSession,
  onImport,
  onDiscard,
}: {
  input: TaxInput;
  session: PortFinSession;
  setSession: (s: PortFinSession) => void;
  onImport: (result: Extract<ImportResult, { ok: true }>) => void;
  onDiscard: (previous: TaxInput) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<unknown>();
  const [originalData, setOriginalData] = useState<PortFinExport>();
  const [error, setError] = useState('');
  const [pastedJson, setPastedJson] = useState('');
  const [reading, setReading] = useState(false);
  const [automaticNavs, setAutomaticNavs] = useState<AutomaticNav[]>([]);
  const [automaticError, setAutomaticError] = useState('');
  const { previous, accepted } = session;
  const preview =
    data === undefined
      ? undefined
      : importPortFinTaxData(data, input, { previousFingerprint: accepted?.fingerprint });
  const preparePreview = async (raw: unknown) => {
    setData(undefined);
    setOriginalData(undefined);
    setAutomaticNavs([]);
    setAutomaticError('');
    const parsed = importPortFinTaxData(raw, input);
    if (!parsed.ok || !parsed.data.gains.some(needsGrandfathering)) {
      setData(raw);
      return;
    }
    setOriginalData(parsed.data);
    try {
      const resolved = applyAmfiNav(parsed.data, await loadAmfiNav());
      setAutomaticNavs(resolved.applied);
      setData(resolved.data);
    } catch {
      setAutomaticError(
        'Automatic historical NAV lookup is unavailable. Retry or use the manual cost fields below.',
      );
      setData(parsed.data);
    }
  };
  const accept = (mode: 'replace' | 'merge') => {
    const result = importPortFinTaxData(data, input, {
      mode,
      previousFingerprint: accepted?.fingerprint,
    });
    if (!result.ok) {
      setError(result.errors.map((e) => e.message).join(' '));
      return;
    }
    onImport(result);
    setSession({
      previous: previous || structuredClone(input),
      accepted: result,
      original: originalData ?? result.data,
      automaticNavs,
    });
    setData(undefined);
    setError('');
  };
  return (
    <div id="portfin-import" className="repeat-card">
      <button className="secondary" disabled={reading} onClick={() => file.current?.click()}>
        {reading ? 'Reading export and matching historical NAVs…' : 'Import from PortFin'}
      </button>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const selected = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          setData(undefined);
          setOriginalData(undefined);
          setError('');
          if (!selected) return;
          setReading(true);
          try {
            if (selected.size > 5_000_000) throw new Error('PortFin file exceeds the 5 MB limit.');
            await preparePreview(parsePortFinJson(await selected.text()));
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not read the file.');
          } finally {
            setReading(false);
          }
        }}
      />
      <details>
        <summary>Paste PortFin JSON if downloads are unavailable</summary>
        <label className="field">
          <span>PortFin JSON</span>
          <textarea
            rows={6}
            maxLength={5_000_000}
            value={pastedJson}
            onChange={(e) => setPastedJson(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={reading}
          onClick={async () => {
            setError('');
            setData(undefined);
            setOriginalData(undefined);
            setReading(true);
            try {
              await preparePreview(parsePortFinJson(pastedJson));
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not read JSON.');
            } finally {
              setReading(false);
            }
          }}
        >
          Preview pasted JSON
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
      {automaticError && (
        <p role="status">
          {automaticError}{' '}
          <button
            className="text-button"
            disabled={reading}
            onClick={async () => {
              if (!originalData) return;
              setReading(true);
              try {
                await preparePreview(originalData);
              } finally {
                setReading(false);
              }
            }}
          >
            Retry automatic lookup
          </button>
        </p>
      )}
      {preview && !preview.ok && (
        <div role="alert">
          <ul>
            {preview.errors.map((e, i) => (
              <li key={i}>
                {e.path}: {e.message}
              </li>
            ))}
          </ul>
          <button className="secondary" onClick={() => setData(undefined)}>
            Cancel
          </button>
        </div>
      )}
      {preview?.ok && (
        <section aria-label="PortFin Import Preview">
          <h3>PortFin Import Preview · FY {preview.data.financialYear}</h3>
          <AutomaticNavNotice entries={automaticNavs} />
          <PortFinTotals result={preview} original={originalData} />
          <dl>
            {Object.entries(preview.data.summary).map(([kind, amounts]) => (
              <div key={kind}>
                <dt>
                  {
                    (
                      {
                        section111A: 'Section 111A STCG',
                        section112A: 'Section 112A LTCG',
                        otherSTCG: 'Other STCG',
                        otherLTCG: 'Other LTCG',
                        review: 'Unclassified',
                      } as Record<string, string>
                    )[kind]
                  }
                </dt>
                <dd>
                  {money(amounts.gain)} gains / {money(amounts.loss)} losses
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Records: {preview.data.gains.length} · Importable: {preview.importedCount} · Review
            required: {preview.reviewCount}
          </p>
          {preview.reviewRequired && (
            <p role="alert">
              This import requires review. The tax estimate will be withheld, including when only
              some records can be imported.
            </p>
          )}
          {preview.reviewRequired && <PortFinReview result={preview} />}
          <GrandfatheringForm
            data={preview.data}
            onResolve={(resolved) => {
              setOriginalData((existing) => existing ?? preview.data);
              setData(resolved);
            }}
          />
          <ul>
            {preview.warnings
              .filter(
                (w) =>
                  !preview.reviewRequired || (w.path !== 'portfin' && !/^gains\.\d+$/.test(w.path)),
              )
              .map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
          </ul>
          {preview.duplicate && (
            <p>This export was already imported. Confirming will leave your gains unchanged.</p>
          )}
          <button className="secondary" onClick={() => setData(undefined)}>
            Cancel
          </button>{' '}
          <button className="primary" onClick={() => accept('replace')}>
            {preview.reviewRequired
              ? 'Import for review — estimate withheld'
              : input.gains.length
                ? 'Replace capital gains'
                : 'Import gains'}
          </button>{' '}
          {input.gains.length > 0 && !accepted && (
            <button className="secondary" onClick={() => accept('merge')}>
              Merge after review
            </button>
          )}
        </section>
      )}
      {accepted && (
        <div role="status">
          <p>
            PortFin imported · FY {accepted.data.financialYear}. {accepted.importedCount} of{' '}
            {accepted.data.gains.length} lots appear in the editable capital gains below.
          </p>
          <PortFinTotals result={accepted} original={session.original} currentGains={input.gains} />
          <AutomaticNavNotice entries={session.automaticNavs ?? []} />
          {accepted.data.gains.some(needsGrandfathering) && (
            <button
              className="secondary"
              disabled={reading}
              onClick={async () => {
                setReading(true);
                try {
                  await preparePreview(session.original ?? accepted.data);
                } finally {
                  setReading(false);
                }
              }}
            >
              Review grandfathering costs
            </button>
          )}
          {accepted.reviewRequired && (
            <>
              <p>
                Estimate withheld. Review the excluded records below. Replace the import when the
                source issues are resolved. Discard restores the previous capital gains; it does not
                calculate tax on this export.
              </p>
              <PortFinReview result={accepted} />
            </>
          )}
          <button
            className="text-button"
            onClick={() => {
              if (previous) onDiscard(previous);
              setSession({});
              setData(undefined);
            }}
          >
            Discard PortFin import and restore previous capital gains
          </button>
        </div>
      )}
    </div>
  );
}
