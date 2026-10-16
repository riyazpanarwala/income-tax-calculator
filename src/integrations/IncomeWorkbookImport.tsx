import { useRef, useState } from 'react';
import { money } from '../format';
import type { TaxInput } from '../tax-engine/types';
import {
  applyIncomeWorkbook,
  readIncomeWorkbook,
  type IncomeWorkbook,
  type InterestCategory,
} from './incomeWorkbook';

export function IncomeWorkbookImport({
  input,
  onImport,
}: {
  input: TaxInput;
  onImport: (next: TaxInput) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<IncomeWorkbook | null>(null);
  const [category, setCategory] = useState<InterestCategory>('interest');
  const [replaceTds, setReplaceTds] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mismatch = preview?.financialYear && preview.financialYear !== input.year;
  return (
    <section
      className="card income-workbook-import"
      aria-label="Import salary, dividends and bank interest"
    >
      <h3>Import your income workbook</h3>
      <p>
        Upload your ITR Excel to fill salary, dividends, bank interest and salary TDS. The file is
        processed in this browser.
      </p>
      <button className="secondary" disabled={reading} onClick={() => picker.current?.click()}>
        {reading ? 'Reading workbook…' : 'Upload income Excel'}
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
          setNotice('');
          setPreview(null);
          setConfirmed(false);
          try {
            setPreview(await readIncomeWorkbook(file));
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not read this workbook.');
          } finally {
            setReading(false);
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {preview && (
        <div>
          <h4>
            {preview.fileName} · {preview.months} salary months
          </h4>
          <dl className="income-import-totals">
            <dt>Basic salary</dt>
            <dd>{money(preview.salary.basic)}</dd>
            <dt>Bonus</dt>
            <dd>{money(preview.salary.bonus)}</dd>
            <dt>Allowances (including HRA)</dt>
            <dd>{money(preview.salary.allowances)}</dd>
            <dt>Arrears → other taxable salary</dt>
            <dd>{money(preview.salary.other)}</dd>
            <dt>Gross salary</dt>
            <dd>{money(Object.values(preview.salary).reduce((sum, n) => sum + n, 0))}</dd>
            <dt>Salary TDS</dt>
            <dd>{money(preview.tds)}</dd>
            <dt>Dividends ({preview.dividendEntries} entries)</dt>
            <dd>{money(preview.dividends)}</dd>
            <dt>Bank interest ({preview.interestEntries} entries)</dt>
            <dd>{money(preview.interest)}</dd>
          </dl>
          <p className="note">
            Uses gross salary before PT and TDS. Net pay and workbook summary totals are excluded.
            Salary components and dividends are replaced. Other income, employer contributions and
            capital gains are preserved.
          </p>
          <label className="field">
            <span>Import bank interest as</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as InterestCategory)}
            >
              <option value="interest">Other taxable interest (type unspecified)</option>
              <option value="savings">Savings-account interest</option>
              <option value="deposits">Fixed-deposit interest</option>
            </select>
            <small>
              Replaces this category only. For a mix of account types, split the amounts in Interest
              &amp; other sources after importing.
            </small>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={replaceTds}
              onChange={(e) => setReplaceTds(e.target.checked)}
            />
            <span>
              Replace total TDS with salary TDS from this workbook. Add any other TDS separately.
            </span>
          </label>
          {preview.warnings.length > 0 && (
            <>
              <ul>
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  I reviewed these items and confirm the amounts belong to FY {input.year}.
                </span>
              </label>
            </>
          )}
          {mismatch && (
            <p role="alert">
              Workbook FY {preview.financialYear} does not match selected FY {input.year}. Upload a
              workbook for the selected year.
            </p>
          )}
          <div className="income-import-actions">
            <button
              className="secondary"
              disabled={Boolean(mismatch) || (preview.warnings.length > 0 && !confirmed)}
              onClick={() => {
                try {
                  onImport(applyIncomeWorkbook(input, preview, category, replaceTds));
                  setNotice(
                    `Imported ${preview.fileName}: salary, dividends and bank interest${replaceTds ? ', plus salary TDS' : ''}. Review or edit the populated fields below. Re-uploading replaces these values without adding duplicates.`,
                  );
                  setPreview(null);
                  setError('');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Import failed.');
                }
              }}
            >
              Fill income fields
            </button>
            <button
              className="text-button"
              onClick={() => {
                setPreview(null);
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
