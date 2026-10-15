import { useRef, useState } from 'react';
import { parseBrokerFile } from '../brokerParser';
import { money } from '../format';
import type { TaxInput } from '../tax-engine/types';
import { prepareFnoImport, type ShoonyaFnoStatement } from './shoonyaFno';

export interface FnoSession {
  statement: ShoonyaFnoStatement;
  previousBusiness: number;
  reviewRequired: boolean;
}
export function ShoonyaFnoImport({
  input,
  preview,
  setPreview,
  session,
  onImport,
  onRemove,
}: {
  input: TaxInput;
  preview: ShoonyaFnoStatement | null;
  setPreview: (s: ShoonyaFnoStatement | null) => void;
  session: FnoSession | null;
  onImport: (s: FnoSession, next: TaxInput) => void;
  onRemove: () => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [confirmedFingerprint, setConfirmedFingerprint] = useState('');
  const [reading, setReading] = useState(false);
  const mismatch = preview && preview.financialYear !== input.year;
  const duplicate = preview && preview.fingerprint === session?.statement.fingerprint;
  return (
    <div className="repeat-card">
      <button className="secondary" disabled={reading} onClick={() => picker.current?.click()}>
        {reading ? 'Reading statement…' : 'Upload Shoonya F&O Excel'}
      </button>
      <input
        ref={picker}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setReading(true);
          setError('');
          setPreview(null);
          setConfirmedFingerprint('');
          try {
            const parsed = await parseBrokerFile(file);
            if (parsed.derivative) setPreview(parsed.derivative);
            else setError(parsed.error || 'Select a Shoonya Derivative PL Statement.');
          } catch {
            setError('Could not read this statement.');
          } finally {
            setReading(false);
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
      {preview && (
        <section aria-label="Shoonya F&O import preview">
          <h3>Shoonya F&O statement · FY {preview.financialYear}</h3>
          <p>
            {preview.fileName} · {preview.from} to {preview.to} · {preview.records} contracts
          </p>
          <dl>
            <dt>Trading P&L before charges</dt>
            <dd>{money(preview.grossPnl)}</dd>
            <dt>Total statement charges</dt>
            <dd>{money(preview.totalCharges)}</dd>
            <dt>Net statement {preview.netPnl < 0 ? 'loss' : 'profit'}</dt>
            <dd>{money(preview.netPnl)}</dd>
          </dl>
          <details>
            <summary>Statement charges</summary>
            <ul>
              {preview.charges.map((c) => (
                <li key={c.label}>
                  {c.label}: {money(c.amount)}
                </li>
              ))}
            </ul>
          </details>
          <ul>
            {[...preview.warnings, ...preview.reviewReasons].map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p>
            F&O is handled separately from equity STCG/LTCG. Salary, capital gains and tax payments
            are preserved.
          </p>
          {mismatch && (
            <p role="alert">
              The statement is for FY {preview.financialYear}, but the calculator is set to FY{' '}
              {input.year}.
            </p>
          )}
          {duplicate && (
            <p role="status">This statement is already imported. It will not be added again.</p>
          )}
          {!preview.reviewReasons.length && !duplicate && (
            <>
              <p>
                This replaces the business-profit field ({money(input.business)}). Include other
                business activity separately in your reconciled total after importing; do not add
                overlapping reports.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmedFingerprint === preview.fingerprint}
                  onChange={(e) =>
                    setConfirmedFingerprint(e.target.checked ? preview.fingerprint : '')
                  }
                />
                I have reconciled this net profit, tax adjustments and report period for my
                business-income estimate.
              </label>
            </>
          )}
          <button
            className="secondary"
            onClick={() => {
              setPreview(null);
              setError('');
            }}
          >
            Cancel
          </button>{' '}
          <button
            className="primary"
            disabled={
              !!mismatch ||
              (!duplicate &&
                !preview.reviewReasons.length &&
                confirmedFingerprint !== preview.fingerprint)
            }
            onClick={() => {
              setError('');
              if (duplicate) {
                setPreview(null);
                return;
              }
              try {
                const prepared = prepareFnoImport(
                  preview,
                  input,
                  confirmedFingerprint === preview.fingerprint,
                );
                onImport(
                  {
                    statement: preview,
                    previousBusiness: session?.previousBusiness ?? input.business,
                    reviewRequired: prepared.reviewRequired,
                  },
                  prepared.input,
                );
                setPreview(null);
                setConfirmedFingerprint('');
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Import failed.');
              }
            }}
          >
            {duplicate
              ? 'Keep existing import'
              : preview.reviewReasons.length
                ? 'Import for review — withhold estimate'
                : 'Import business profit'}
          </button>
        </section>
      )}
      {session && (
        <div role="status">
          <p>
            Shoonya F&O imported: {session.statement.from} to {session.statement.to} · Net P&L{' '}
            {money(session.statement.netPnl)}
          </p>
          {session.reviewRequired && (
            <p>
              The estimate is withheld. Resolve the statement review items or remove this import.
              Losses have not been deducted from salary or capital gains.
            </p>
          )}
          <button className="text-button" onClick={onRemove}>
            Remove F&O import and restore previous business profit
          </button>
        </div>
      )}
    </div>
  );
}
