import { useRef, useState } from 'react';
import type { TaxInput } from '../tax-engine/types';
import { importPortFinTaxData, parsePortFinJson, type ImportResult } from './portfin';
import { money } from '../format';

export interface PortFinSession {
  previous?: TaxInput;
  accepted?: Extract<ImportResult, { ok: true }>;
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
  const [error, setError] = useState('');
  const [pastedJson, setPastedJson] = useState('');
  const { previous, accepted } = session;
  const preview =
    data === undefined
      ? undefined
      : importPortFinTaxData(data, input, { previousFingerprint: accepted?.fingerprint });
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
    setSession({ previous: previous || structuredClone(input), accepted: result });
    setData(undefined);
    setError('');
  };
  return (
    <div className="repeat-card">
      <button className="secondary" onClick={() => file.current?.click()}>
        Import from PortFin
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
          setError('');
          if (!selected) return;
          try {
            if (selected.size > 5_000_000) throw new Error('PortFin file exceeds the 5 MB limit.');
            setData(parsePortFinJson(await selected.text()));
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not read the file.');
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
          onClick={() => {
            setError('');
            setData(undefined);
            try {
              setData(parsePortFinJson(pastedJson));
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not read JSON.');
            }
          }}
        >
          Preview pasted JSON
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
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
          <p>
            Gross gains and losses are shown separately. No loss set-off or annual exemption has
            been applied.
          </p>
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
          <ul>
            {preview.warnings.map((w, i) => (
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
            {input.gains.length ? 'Replace capital gains' : 'Import gains'}
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
            PortFin imported · FY {accepted.data.financialYear}. Edit or remove individual gains
            below.
          </p>
          {accepted.reviewRequired && (
            <>
              <p>
                Unresolved PortFin records: estimate withheld. Reconcile the source and replace this
                import, or discard it before proceeding.
              </p>
              <ul>
                {accepted.warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
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
