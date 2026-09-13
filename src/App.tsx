import { useState, useRef, type ReactNode } from 'react';
import { emptyInput, type TaxInput, type Gain } from './tax-engine/types';
import { calculateFinalTax } from './tax-engine/calculateFinalTax';
import { taxYears } from './tax-rules';
import Breakdown, { LedgerRow } from './Breakdown';
import { money, whole, percent, inputNumber, parseAmount } from './format';
import { parseBrokerFile, KNOWN_BROKERS } from './brokerParser';

export interface BrokerItem {
  id: string;
  broker: string;
  customName?: string;
  stcg111A: number;
  ltcg112A: number;
  fileName?: string;
  details?: string;
}

export interface SalaryPeriod {
  id: string;
  label: string;
  months: number;
  basicMonthly: number;
  daMonthly: number;
  allowancesMonthly: number;
}

const defaultSalaryPeriods: SalaryPeriod[] = [
  {
    id: '1',
    label: 'Pre-Appraisal (Initial Months)',
    months: 4,
    basicMonthly: 80000,
    daMonthly: 0,
    allowancesMonthly: 20000,
  },
  {
    id: '2',
    label: 'Post-Appraisal (Hike Months)',
    months: 8,
    basicMonthly: 100000,
    daMonthly: 0,
    allowancesMonthly: 25000,
  },
];

const defaultBrokers: BrokerItem[] = [
  { id: '1', broker: 'Religare Broking', stcg111A: 0, ltcg112A: 0 },
  { id: '2', broker: 'Shoonya (Finvasia)', stcg111A: 0, ltcg112A: 0 },
  { id: '3', broker: 'Groww', stcg111A: 0, ltcg112A: 0 },
];

const example = () => {
  const x = emptyInput();
  x.salary.basic = 1500000;
  return x;
};
function Amount({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const [raw, setRaw] = useState(inputNumber(value));
  const [prevVal, setPrevVal] = useState(value);
  if (value !== prevVal) {
    setPrevVal(value);
    setRaw(inputNumber(value));
  }
  return (
    <label className="field">
      <span>{label}</span>
      <div className={`amount-input ${Number.isNaN(value) ? 'invalid' : ''}`}>
        <span>₹</span>
        <input
          inputMode="decimal"
          type="text"
          value={raw}
          placeholder="0"
          aria-invalid={Number.isNaN(value)}
          onChange={(e) => {
            const text = e.target.value;
            setRaw(text);
            onChange(parseAmount(text));
          }}
          onBlur={() => {
            if (Number.isFinite(value)) setRaw(inputNumber(value));
          }}
        />
      </div>
      {Number.isNaN(value) && (
        <small role="alert">Enter a valid amount, for example 1,25,000.</small>
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Panel({
  id,
  num,
  title,
  caption,
  children,
  open = false,
}: {
  id: string;
  num: string;
  title: string;
  caption: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details id={id} className="card input-panel" open={open}>
      <summary>
        <span className="step">{num}</span>
        <span>
          <strong>{title}</strong>
          <small>{caption}</small>
        </span>
        <span className="chevron">⌄</span>
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  );
}
function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
const sourceAct =
  'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf';
export default function App() {
  const [input, setInput] = useState<TaxInput>(example);
  const [sample, setSample] = useState(true);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState('calculator');
  const [capitalGainsMode, setCapitalGainsMode] = useState<'broker' | 'manual'>('broker');
  const [brokers, setBrokers] = useState<BrokerItem[]>(defaultBrokers);
  const [parsingFile, setParsingFile] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Salary Periods & Appraisal Helper State
  const [showSalaryHelper, setShowSalaryHelper] = useState(false);
  const [salaryPeriods, setSalaryPeriods] = useState<SalaryPeriod[]>(defaultSalaryPeriods);
  const [helperBonus, setHelperBonus] = useState(0);
  const [helperCommission, setHelperCommission] = useState(0);
  const [helperPerquisites, setHelperPerquisites] = useState(0);
  const [salaryHelperApplied, setSalaryHelperApplied] = useState(false);

  const update = (fn: (x: TaxInput) => void) => {
    setInput((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setSample(false);
  };

  const syncBrokers = (brokerList: BrokerItem[]) => {
    const currentRules = taxYears[input.year] ?? taxYears['2026-27'];
    const totalStcg = brokerList.reduce((acc, b) => acc + (b.stcg111A || 0), 0);
    const totalLtcg = brokerList.reduce((acc, b) => acc + (b.ltcg112A || 0), 0);

    update((x) => {
      const nextGains: Gain[] = [];
      if (totalStcg > 0) {
        nextGains.push({
          kind: '111A',
          asset: 'equity',
          amount: totalStcg,
          acquired: currentRules.start,
          sold: `${currentRules.start.slice(0, 4)}-09-15`,
          confirmed: true,
        });
      }
      if (totalLtcg > 0) {
        nextGains.push({
          kind: '112A',
          asset: 'equity',
          amount: totalLtcg,
          acquired: '2024-04-01',
          sold: `${currentRules.start.slice(0, 4)}-05-15`,
          confirmed: true,
        });
      }
      x.gains = nextGains;
    });
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setParsingFile(true);
    setUploadNotice(null);
    try {
      let nextBrokers = [...brokers];
      const messages: string[] = [];
      for (const file of files) {
        const parsed = await parseBrokerFile(file);
        if (parsed.success) {
          const existingIdx = nextBrokers.findIndex(
            (b) =>
              b.broker.toLowerCase() === parsed.brokerName.toLowerCase() ||
              (b.customName && b.customName.toLowerCase() === parsed.brokerName.toLowerCase()),
          );
          if (existingIdx !== -1) {
            nextBrokers[existingIdx] = {
              ...nextBrokers[existingIdx],
              stcg111A: parsed.stcg111A,
              ltcg112A: parsed.ltcg112A,
              fileName: parsed.fileName,
              details: parsed.details,
            };
          } else {
            nextBrokers.push({
              id: String(Date.now() + Math.random()),
              broker: parsed.brokerName,
              stcg111A: parsed.stcg111A,
              ltcg112A: parsed.ltcg112A,
              fileName: parsed.fileName,
              details: parsed.details,
            });
          }
          messages.push(
            `✓ ${parsed.brokerName}: ₹${parsed.stcg111A.toLocaleString('en-IN')} STCG, ₹${parsed.ltcg112A.toLocaleString('en-IN')} LTCG`,
          );
        } else {
          messages.push(`⚠ ${file.name}: ${parsed.error || 'Could not detect numbers'}`);
        }
      }
      setBrokers(nextBrokers);
      syncBrokers(nextBrokers);
      if (messages.length) {
        setUploadNotice(messages.join(' | '));
      }
    } finally {
      setParsingFile(false);
    }
  };

  const reset = (demo: boolean) => {
    setInput(demo ? example() : emptyInput());
    setSample(demo);
    setRevision((x) => x + 1);
    setBrokers(
      defaultBrokers.map((b) => ({
        ...b,
        stcg111A: 0,
        ltcg112A: 0,
        fileName: undefined,
        details: undefined,
      })),
    );
    setUploadNotice(null);
    setSalaryPeriods(defaultSalaryPeriods);
    setHelperBonus(0);
    setHelperCommission(0);
    setHelperPerquisites(0);
  };

  const totalSalaryMonths = salaryPeriods.reduce((acc, p) => acc + (p.months || 0), 0);
  const helperComputedBasic = salaryPeriods.reduce(
    (acc, p) => acc + (p.months || 0) * (p.basicMonthly || 0),
    0,
  );
  const helperComputedDa = salaryPeriods.reduce(
    (acc, p) => acc + (p.months || 0) * (p.daMonthly || 0),
    0,
  );
  const helperComputedAllowances = salaryPeriods.reduce(
    (acc, p) => acc + (p.months || 0) * (p.allowancesMonthly || 0),
    0,
  );
  const helperComputedTotalGross =
    helperComputedBasic +
    helperComputedDa +
    helperComputedAllowances +
    (helperBonus || 0) +
    (helperCommission || 0) +
    (helperPerquisites || 0);

  const applySalaryHelper = () => {
    update((x) => {
      x.salary.basic = helperComputedBasic;
      x.salary.da = helperComputedDa;
      x.salary.allowances = helperComputedAllowances;
      x.salary.bonus = helperBonus;
      x.salary.commission = helperCommission;
      x.salary.perquisites = helperPerquisites;
    });
    setSalaryHelperApplied(true);
    setTimeout(() => setSalaryHelperApplied(false), 4000);
  };

  const rules = taxYears[input.year];
  const calculation = calculateFinalTax(input);
  const result = calculation.ok ? calculation.result : null;
  const fields = <K extends 'salary' | 'other' | 'payments'>(
    group: K,
    labels: Partial<Record<keyof TaxInput[K], string>>,
  ) =>
    Object.entries(labels).map(([key, label]) => (
      <Amount
        key={key}
        label={label as string}
        value={(input[group] as unknown as Record<string, number>)[key]}
        onChange={(v) =>
          update((x) => {
            (x[group] as unknown as Record<string, number>)[key] = v;
          })
        }
      />
    ));
  return (
    <>
      <a className="skip" href="#main">
        Skip to calculator
      </a>
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setTab('calculator')}>
          <span className="brand-icon">₹</span>taxfolio<span className="brand-dot">.</span>
        </a>
        <span className="header-label">INDIAN INCOME TAX CALCULATOR</span>
        <span className="privacy">
          <span>◉</span> Your numbers stay in this browser
        </span>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-label">YOUR TAX WORKSPACE</div>
          <nav aria-label="Workspace">
            {[
              ['calculator', '▦', 'Calculator'],
              ['breakdown', '≡', 'Calculation breakdown'],
              ['rules', '§', 'Rules & sources'],
            ].map(([key, icon, label]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
                <span className="nav-icon">{icon}</span>
                {label}
                {tab === key && <span className="nav-dot" />}
              </button>
            ))}
          </nav>
          <div className="year-note">
            <span className="tiny-label">CURRENT TAX YEAR</span>
            <strong>{rules.year}</strong>
            <p>
              New tax regime
              <br />
              Income-tax Act, 2025
            </p>
            <span className="tag">Individual taxpayers</span>
          </div>
          <div className="sidebar-foot">
            Clarity in every calculation.
            <br />
            <span>No account. No data uploads.</span>
          </div>
        </aside>
        <main id="main">
          <div className="page-heading">
            <div className="eyebrow">
              TAX YEAR {rules.year} <span> / </span> NEW REGIME
            </div>
            <div className="title-row">
              <div>
                <h1>
                  {tab === 'calculator'
                    ? 'Make sense of your income tax.'
                    : tab === 'breakdown'
                      ? 'Every rupee, explained.'
                      : 'The rules behind the numbers.'}
                </h1>
                <p>
                  {tab === 'calculator'
                    ? 'Add your income and see exactly how your tax is calculated.'
                    : tab === 'breakdown'
                      ? 'A complete trail from income to your estimated tax liability.'
                      : 'Official references, supported cases, and explicit limitations.'}
                </p>
              </div>
              {tab !== 'rules' && (
                <button className="secondary print-button" onClick={() => window.print()}>
                  ↗ Print breakdown
                </button>
              )}
            </div>
          </div>
          {tab === 'rules' ? (
            <div className="rules-content">
              <section className="card">
                <span className="tag">SOURCE REVIEW · {rules.verifiedOn}</span>
                <h2>FY / Tax Year {rules.year}</h2>
                <p>
                  The Income-tax Act, 2025 applies from 1 April 2026. Familiar section names such as
                  87A, 111A and 80CCD are shown for recognition alongside their current equivalents.
                  This is not AY 2026–27.
                </p>
                <ul className="source-list">
                  <li>
                    <a href={sourceAct} target="_blank" rel="noreferrer">
                      Income-tax Act, 2025, amended by Finance Act, 2026 ↗
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.incometaxindia.gov.in/documents/d/guest/finance-act-2026-pdf-1"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Enacted Finance Act, 2026 · surcharge & cess ↗
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.incometaxindia.gov.in/w/section-156-88"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Section 156 · resident rebate and marginal relief ↗
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.incometaxindia.gov.in/en/income-tax-calculator"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Income Tax Department calculator ↗
                    </a>
                  </li>
                </ul>
              </section>
              <section className="card">
                <h2>Permitted deductions</h2>
                <p>
                  Salary standard deduction: up to {money(rules.salaryDeduction)}. Family-pension
                  deduction: one-third, capped at {money(rules.familyPension.maximum)}. No 80C, 80D,
                  HRA or self-occupied interest deduction.
                </p>
                {Object.values(rules.deductions).map((d) => (
                  <div className="deduction-rule" key={d.section}>
                    <h3>{d.name}</h3>
                    <span className="tag">{d.section}</span>
                    <p>
                      {d.maximumLimit}. {d.eligibility}
                    </p>
                  </div>
                ))}
              </section>
              <section className="card">
                <h2>What this release supports</h2>
                <p>
                  Ordinary income, computed business profits, property income with restricted
                  set-off, employer NPS, government Agniveer contribution, and classified
                  non-negative capital gains. Capital gain amounts must already reflect the legally
                  applicable cost and eligible exemptions; the 112A tax band is applied
                  automatically.
                </p>
                <h3>Cases that withhold an estimate</h3>
                <p>
                  Salary exemptions; capital or business losses; foreign and treaty relief;
                  agricultural income; crypto, lottery and other special income; unclassified LTCG;
                  grandfathering; protected property indexation; ambiguous basic-exemption
                  allocation; and mixed-rate surcharge cases above ₹50 lakh. Select the relevant
                  case in the calculator to avoid an incomplete estimate.
                </p>
                <p>
                  Income entered for NRI/RNOR taxpayers must already be scoped to income taxable in
                  India. Interest, late fees, penalties, tax-credit eligibility and filing
                  obligations are not calculated.
                </p>
                <h3>Verification scope</h3>
                <p>
                  Representative ordinary-income calculations were compared with the official
                  calculator for tax year 2026–27. Complex special-rate cases use statutory
                  fixtures; the simple official calculator does not accept their component inputs.
                  See the repository’s tax-rules and verification documents for exact results and
                  remaining release limitations.
                </p>
              </section>
            </div>
          ) : (
            <div className="calculator-grid">
              <div className="input-column">
                {tab === 'calculator' ? (
                  <div key={revision}>
                    <div className="context-bar">
                      <span className="tag">NEW REGIME</span>
                      <label>
                        Tax year{' '}
                        <select
                          value={input.year}
                          onChange={(e) =>
                            update((x) => {
                              x.year = e.target.value;
                            })
                          }
                        >
                          {Object.values(taxYears).map((r) => (
                            <option key={r.year}>{r.year}</option>
                          ))}
                        </select>
                      </label>
                      <button className="text-button" onClick={() => reset(false)}>
                        Reset all
                      </button>
                    </div>
                    {sample ? (
                      <div className="sample-banner">
                        <span>
                          ✧ Example: {whole(input.salary.basic)} annual salary. Replace it with your
                          figures.
                        </span>
                        <button onClick={() => reset(false)}>Start blank →</button>
                      </div>
                    ) : (
                      <div className="sample-link">
                        <button className="text-button" onClick={() => reset(true)}>
                          Load salary example
                        </button>
                        <span>All amounts are annual, in INR.</span>
                      </div>
                    )}
                    <Panel
                      id="profile"
                      num="01"
                      title="Taxpayer details"
                      caption="Your residency determines rebate eligibility"
                      open
                    >
                      <div className="fields">
                        <label className="field">
                          <span>Taxpayer type</span>
                          <select value={input.taxpayer} disabled>
                            <option value="individual">Individual</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Residential status</span>
                          <select
                            value={input.residency}
                            onChange={(e) =>
                              update((x) => {
                                x.residency = e.target.value as TaxInput['residency'];
                              })
                            }
                          >
                            <option value="resident">Resident</option>
                            <option value="rnor">Resident, not ordinarily resident</option>
                            <option value="non-resident">Non-resident (NRI)</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Age at tax-year end</span>
                          <input
                            type="number"
                            min="18"
                            max="120"
                            value={Number.isNaN(input.age) ? '' : input.age}
                            onChange={(e) =>
                              update((x) => {
                                x.age = e.target.value === '' ? NaN : Number(e.target.value);
                              })
                            }
                          />
                        </label>
                        <p className="field-note">
                          The new regime uses the same slabs at every adult age. Residents and RNOR
                          individuals may qualify for rebate.
                        </p>
                      </div>
                    </Panel>
                    <Panel
                      id="salary"
                      num="02"
                      title="Salary & regular pension"
                      caption="Salary components, employer contributions and standard deduction"
                      open
                    >
                      <div className="salary-helper-toggle-wrap">
                        <button
                          type="button"
                          className="salary-helper-btn"
                          onClick={() => setShowSalaryHelper((prev) => !prev)}
                        >
                          ⚡{' '}
                          {showSalaryHelper
                            ? 'Hide Salary Periods & Appraisal Helper'
                            : 'Calculate from Monthly / Appraisal Periods'}
                        </button>
                        {salaryHelperApplied && (
                          <span className="apply-success-toast">
                            ✓ Applied to annual salary inputs below!
                          </span>
                        )}
                      </div>

                      {showSalaryHelper && (
                        <div className="salary-helper-card">
                          <div className="salary-helper-header">
                            <div>
                              <h4>Salary Periods, Appraisal &amp; Gap Helper</h4>
                              <small style={{ color: 'var(--muted)' }}>
                                Break your year into periods (e.g. pre-appraisal, post-appraisal,
                                career break / zero-salary month)
                              </small>
                            </div>
                            <div
                              className={`months-meter ${
                                totalSalaryMonths === 12
                                  ? 'complete'
                                  : totalSalaryMonths < 12
                                    ? 'incomplete'
                                    : 'overflow'
                              }`}
                            >
                              <span>📅 Total: {totalSalaryMonths} / 12 Months</span>
                              {totalSalaryMonths === 12 && <span>✓</span>}
                              {totalSalaryMonths < 12 && (
                                <span>({12 - totalSalaryMonths} mo. gap/unaccounted)</span>
                              )}
                              {totalSalaryMonths > 12 && <span>(exceeds 12 mo.)</span>}
                            </div>
                          </div>

                          {salaryPeriods.map((period, idx) => (
                            <div className="period-card" key={period.id}>
                              <div className="period-card-header">
                                <div className="period-name-group">
                                  <span className="period-badge">Period {idx + 1}</span>
                                  <input
                                    type="text"
                                    value={period.label}
                                    placeholder="e.g. Pre-appraisal, Hike months, Job break"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setSalaryPeriods((prev) =>
                                        prev.map((p) =>
                                          p.id === period.id ? { ...p, label: val } : p,
                                        ),
                                      );
                                    }}
                                    style={{
                                      fontWeight: 600,
                                      fontSize: '12px',
                                      padding: '4px 8px',
                                      borderRadius: '5px',
                                      border: '1px solid #dce2d6',
                                      minWidth: '220px',
                                    }}
                                  />
                                </div>
                                {salaryPeriods.length > 1 && (
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={() => {
                                      setSalaryPeriods((prev) =>
                                        prev.filter((p) => p.id !== period.id),
                                      );
                                    }}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>

                              <div className="period-inputs-grid">
                                <label className="field">
                                  <span>Duration (months)</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="12"
                                    value={period.months}
                                    onChange={(e) => {
                                      const m = Math.max(
                                        1,
                                        Math.min(12, parseInt(e.target.value) || 1),
                                      );
                                      setSalaryPeriods((prev) =>
                                        prev.map((p) =>
                                          p.id === period.id ? { ...p, months: m } : p,
                                        ),
                                      );
                                    }}
                                  />
                                </label>
                                <Amount
                                  label="Monthly Basic / Pension"
                                  value={period.basicMonthly}
                                  onChange={(v) => {
                                    setSalaryPeriods((prev) =>
                                      prev.map((p) =>
                                        p.id === period.id ? { ...p, basicMonthly: v } : p,
                                      ),
                                    );
                                  }}
                                />
                                <Amount
                                  label="Monthly Dearness Allowance (DA)"
                                  value={period.daMonthly}
                                  onChange={(v) => {
                                    setSalaryPeriods((prev) =>
                                      prev.map((p) =>
                                        p.id === period.id ? { ...p, daMonthly: v } : p,
                                      ),
                                    );
                                  }}
                                />
                                <Amount
                                  label="Monthly Taxable Allowances"
                                  value={period.allowancesMonthly}
                                  onChange={(v) => {
                                    setSalaryPeriods((prev) =>
                                      prev.map((p) =>
                                        p.id === period.id ? { ...p, allowancesMonthly: v } : p,
                                      ),
                                    );
                                  }}
                                />
                              </div>
                            </div>
                          ))}

                          <div
                            style={{
                              display: 'flex',
                              gap: '10px',
                              marginTop: '10px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                const remaining = Math.max(1, 12 - totalSalaryMonths);
                                setSalaryPeriods((prev) => [
                                  ...prev,
                                  {
                                    id: String(Date.now()),
                                    label: `Period ${prev.length + 1} (Post-Appraisal / New Job)`,
                                    months: remaining,
                                    basicMonthly: 100000,
                                    daMonthly: 0,
                                    allowancesMonthly: 25000,
                                  },
                                ]);
                              }}
                            >
                              + Add Another Period (e.g. Hike or Switch)
                            </button>

                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                const remaining = Math.max(1, 12 - totalSalaryMonths);
                                setSalaryPeriods((prev) => [
                                  ...prev,
                                  {
                                    id: String(Date.now()),
                                    label: 'Career Break / Unemployed Gap',
                                    months: remaining,
                                    basicMonthly: 0,
                                    daMonthly: 0,
                                    allowancesMonthly: 0,
                                  },
                                ]);
                              }}
                            >
                              + Add Unemployed / Gap Month (₹0)
                            </button>
                          </div>

                          <div
                            style={{
                              marginTop: '14px',
                              paddingTop: '12px',
                              borderTop: '1px solid #e1e7dc',
                            }}
                          >
                            <h4 style={{ margin: '0 0 10px', fontSize: '12px', color: '#384d3b' }}>
                              One-off Annual Components (Bonus, Commission, Perquisites)
                            </h4>
                            <div className="fields">
                              <Amount
                                label="One-off Bonus / Variable Pay (Annual total)"
                                value={helperBonus}
                                onChange={setHelperBonus}
                              />
                              <Amount
                                label="Commission / Incentives (Annual total)"
                                value={helperCommission}
                                onChange={setHelperCommission}
                              />
                              <Amount
                                label="Taxable Perquisites (Annual total)"
                                value={helperPerquisites}
                                onChange={setHelperPerquisites}
                              />
                            </div>
                          </div>

                          <div className="helper-summary-bar">
                            <div className="helper-summary-values">
                              <span>
                                Annual Basic: <strong>{money(helperComputedBasic)}</strong>
                              </span>
                              {helperComputedDa > 0 && (
                                <span>
                                  Annual DA: <strong>{money(helperComputedDa)}</strong>
                                </span>
                              )}
                              <span>
                                Annual Allowances:{' '}
                                <strong>{money(helperComputedAllowances)}</strong>
                              </span>
                              {helperBonus > 0 && (
                                <span>
                                  Bonus: <strong>{money(helperBonus)}</strong>
                                </span>
                              )}
                              <span>
                                Gross Computed: <strong>{money(helperComputedTotalGross)}</strong>
                              </span>
                            </div>
                            <button type="button" className="apply-btn" onClick={applySalaryHelper}>
                              ✓ Apply to Annual Salary Inputs
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="fields">
                        {fields('salary', {
                          basic: 'Basic salary / regular pension',
                          da: 'Dearness allowance',
                          bonus: 'Bonus',
                          commission: 'Commission',
                          allowances: 'Taxable allowances',
                          perquisites: 'Taxable perquisites',
                          other: 'Other taxable salary',
                        })}
                      </div>
                      <div className="info-line">
                        <span>✦</span>
                        <span>
                          Standard deduction up to <strong>{whole(rules.salaryDeduction)}</strong>{' '}
                          is applied automatically, limited to your salary.
                        </span>
                      </div>
                      <details className="inner-detail">
                        <summary>Employer NPS & Agniveer contributions</summary>
                        <p className="note">
                          Enter these separately; they are automatically included in gross salary.
                          Do not include them again in other salary. Employer NPS above the eligible
                          deduction limit remains taxable.
                        </p>
                        <div className="fields">
                          {fields('salary', {
                            employerNps: 'Employer NPS contribution',
                            npsEligibleDa: 'DA forming part of retirement benefits',
                            agniveerGovernment: 'Central Government Agniveer contribution',
                          })}
                        </div>
                        <Check
                          checked={input.salary.isAgniveer}
                          onChange={(v) =>
                            update((x) => {
                              x.salary.isAgniveer = v;
                            })
                          }
                        >
                          I am an eligible Agnipath enrollee.
                        </Check>
                      </details>
                      <Check
                        checked={input.unsupported.salaryExemptions}
                        onChange={(v) =>
                          update((x) => {
                            x.unsupported.salaryExemptions = v;
                          })
                        }
                      >
                        I need salary exemptions calculated (unsupported).
                      </Check>
                      <p className="note">
                        Include taxable employer PF/superannuation excess and accretion in
                        perquisites after a separate computation.
                      </p>
                    </Panel>
                    <Panel
                      id="property"
                      num="03"
                      title="House property"
                      caption="Self-occupied or let-out properties"
                    >
                      <p className="note">
                        For let-out property, enter the legally determined gross annual value (which
                        may exceed rent received). Municipal taxes must be paid by the owner during
                        this year. Losses are aggregated within this head only.
                      </p>
                      {input.properties.map((p, i) => (
                        <div className="repeat-card" key={i}>
                          <div className="repeat-header">
                            <h3>Property {i + 1}</h3>
                            <button
                              className="text-button"
                              onClick={() => {
                                update((x) => {
                                  x.properties.splice(i, 1);
                                });
                                setRevision((x) => x + 1);
                              }}
                            >
                              Remove
                            </button>
                          </div>
                          <label className="field">
                            <span>Property use</span>
                            <select
                              value={p.occupancy}
                              onChange={(e) =>
                                update((x) => {
                                  x.properties[i].occupancy = e.target.value as 'self' | 'let';
                                })
                              }
                            >
                              <option value="self">Self-occupied</option>
                              <option value="let">Let-out</option>
                            </select>
                          </label>
                          <div className="fields">
                            {(['annualValue', 'municipalTaxes', 'interest'] as const).map(
                              (key, n) => (
                                <Amount
                                  key={key}
                                  label={
                                    [
                                      'Gross annual value / annual rent',
                                      'Municipal taxes paid',
                                      'Interest on borrowed capital',
                                    ][n]
                                  }
                                  value={p[key]}
                                  onChange={(v) =>
                                    update((x) => {
                                      x.properties[i][key] = v;
                                    })
                                  }
                                />
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                      <button
                        className="secondary"
                        onClick={() =>
                          update((x) => {
                            x.properties.push({
                              occupancy: 'let',
                              annualValue: 0,
                              municipalTaxes: 0,
                              interest: 0,
                            });
                          })
                        }
                      >
                        + Add property
                      </button>
                      <p className="note">
                        Self-occupied interest is not deducted. Net property loss cannot reduce
                        other income.
                      </p>
                    </Panel>
                    <Panel
                      id="business"
                      num="04"
                      title="Business / profession"
                      caption="Already-computed taxable profit"
                    >
                      <Amount
                        label="Taxable business or professional profit"
                        value={input.business}
                        onChange={(v) =>
                          update((x) => {
                            x.business = v;
                          })
                        }
                      />
                      <p className="note">
                        Enter profit after applicable tax adjustments under the new regime. This is
                        not turnover. Presumptive income, depreciation and business expense
                        calculations must be completed separately.
                      </p>
                    </Panel>
                    <Panel
                      id="other"
                      num="05"
                      title="Interest & other sources"
                      caption="Interest, ordinary dividends and family pension"
                    >
                      <div className="fields">
                        {fields('other', {
                          savings: 'Savings-account interest',
                          deposits: 'Fixed-deposit interest',
                          dividends: 'Ordinary-rate dividends',
                          familyPension: 'Family pension',
                          interest: 'Other taxable interest',
                          ordinary: 'Other ordinary taxable income',
                        })}
                      </div>
                      <p className="note">
                        Family pension is separate from your own employment pension. Its deduction
                        is automatically limited to one-third or{' '}
                        {money(rules.familyPension.maximum)}, whichever is lower. Do not enter
                        special-rate NRI dividends here.
                      </p>
                    </Panel>
                    <Panel
                      id="gains"
                      num="06"
                      title="Capital gains"
                      caption="Special-rate gains stay separate from your salary"
                    >
                      <div className="mode-toggle">
                        <button
                          type="button"
                          className={capitalGainsMode === 'broker' ? 'active' : ''}
                          onClick={() => {
                            setCapitalGainsMode('broker');
                            syncBrokers(brokers);
                          }}
                        >
                          📊 By Broker Statement (Multi-Broker / Excel)
                        </button>
                        <button
                          type="button"
                          className={capitalGainsMode === 'manual' ? 'active' : ''}
                          onClick={() => setCapitalGainsMode('manual')}
                        >
                          📝 Manual / Property / Other Assets
                        </button>
                      </div>

                      {capitalGainsMode === 'broker' ? (
                        <>
                          <div
                            className={`broker-dropzone ${dragOver ? 'drag-over' : ''}`}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragOver(true);
                            }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={async (e) => {
                              e.preventDefault();
                              setDragOver(false);
                              if (e.dataTransfer.files?.length) {
                                await handleFiles(e.dataTransfer.files);
                              }
                            }}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <input
                              type="file"
                              ref={fileInputRef}
                              style={{ display: 'none' }}
                              multiple
                              accept=".xlsx,.xls,.csv"
                              onChange={async (e) => {
                                if (e.target.files?.length) {
                                  await handleFiles(e.target.files);
                                }
                              }}
                            />
                            <div className="dropzone-icon">📥</div>
                            <div className="dropzone-title">
                              {parsingFile
                                ? 'Analyzing statements...'
                                : 'Upload Tax P&L Statements (Excel / CSV)'}
                            </div>
                            <div className="dropzone-hint">
                              Drop your Capital Gains statements from <strong>Religare</strong>,{' '}
                              <strong>Shoonya</strong>, <strong>Groww</strong>,{' '}
                              <strong>Zerodha</strong>, or any broker.
                              <br />
                              STCG (111A) and LTCG (112A) are automatically extracted. You can drop
                              multiple files at once.
                            </div>
                          </div>

                          {uploadNotice && (
                            <div className="info-line">
                              <span>ⓘ</span>
                              <span>{uploadNotice}</span>
                              <button
                                className="text-button"
                                style={{ marginLeft: 'auto' }}
                                onClick={() => setUploadNotice(null)}
                              >
                                ✕ Dismiss
                              </button>
                            </div>
                          )}

                          {brokers.map((item, i) => (
                            <div className="broker-card" key={item.id}>
                              <div className="broker-card-header">
                                <div className="broker-title-group">
                                  <span className="broker-badge">Broker {i + 1}</span>
                                  <select
                                    value={item.broker}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const updated = brokers.map((b) =>
                                        b.id === item.id ? { ...b, broker: val } : b,
                                      );
                                      setBrokers(updated);
                                    }}
                                    style={{
                                      fontWeight: 600,
                                      padding: '5px 8px',
                                      borderRadius: '5px',
                                      border: '1px solid #dce2d6',
                                    }}
                                  >
                                    <option value="Religare Broking">Religare Broking</option>
                                    <option value="Shoonya (Finvasia)">Shoonya (Finvasia)</option>
                                    <option value="Groww">Groww</option>
                                    <option value="Zerodha">Zerodha</option>
                                    <option value="Upstox">Upstox</option>
                                    <option value="Angel One">Angel One</option>
                                    <option value="ICICI Direct">ICICI Direct</option>
                                    <option value="HDFC Sky / Securities">
                                      HDFC Sky / Securities
                                    </option>
                                    <option value="Dhan">Dhan</option>
                                    <option value="Kotak Securities">Kotak Securities</option>
                                    <option value="Motilal Oswal">Motilal Oswal</option>
                                    <option value="5paisa">5paisa</option>
                                    <option value="Paytm Money">Paytm Money</option>
                                    <option value="Axis Direct">Axis Direct</option>
                                    <option value="Sharekhan">Sharekhan</option>
                                    <option value="Other / Custom Broker">
                                      Other / Custom Broker
                                    </option>
                                  </select>
                                  {item.broker === 'Other / Custom Broker' && (
                                    <input
                                      type="text"
                                      placeholder="Broker name"
                                      value={item.customName || ''}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const updated = brokers.map((b) =>
                                          b.id === item.id ? { ...b, customName: val } : b,
                                        );
                                        setBrokers(updated);
                                      }}
                                      style={{
                                        width: '150px',
                                        padding: '5px 8px',
                                        borderRadius: '5px',
                                        border: '1px solid #dce2d6',
                                      }}
                                    />
                                  )}
                                </div>
                                <div className="broker-actions">
                                  <label
                                    className="file-upload-label"
                                    title="Upload statement for this broker"
                                  >
                                    📁 Upload statement
                                    <input
                                      type="file"
                                      style={{ display: 'none' }}
                                      accept=".xlsx,.xls,.csv"
                                      onChange={async (e) => {
                                        if (e.target.files?.[0]) {
                                          const file = e.target.files[0];
                                          const parsed = await parseBrokerFile(file);
                                          const updated = brokers.map((b) =>
                                            b.id === item.id
                                              ? {
                                                  ...b,
                                                  stcg111A: parsed.stcg111A,
                                                  ltcg112A: parsed.ltcg112A,
                                                  fileName: file.name,
                                                  details:
                                                    parsed.details ||
                                                    (parsed.success ? 'Extracted' : parsed.error),
                                                }
                                              : b,
                                          );
                                          setBrokers(updated);
                                          syncBrokers(updated);
                                        }
                                      }}
                                    />
                                  </label>
                                  {brokers.length > 1 && (
                                    <button
                                      className="text-button"
                                      onClick={() => {
                                        const updated = brokers.filter((b) => b.id !== item.id);
                                        setBrokers(updated);
                                        syncBrokers(updated);
                                      }}
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                              {item.fileName && (
                                <div className="extracted-info">
                                  <span>✓ Auto-extracted:</span>
                                  <span>
                                    {item.fileName} ({item.details || 'statement summary'})
                                  </span>
                                </div>
                              )}
                              <div className="fields">
                                <Amount
                                  label="Short-term capital gain (STCG 111A)"
                                  value={item.stcg111A}
                                  onChange={(v) => {
                                    const updated = brokers.map((b) =>
                                      b.id === item.id ? { ...b, stcg111A: v } : b,
                                    );
                                    setBrokers(updated);
                                    syncBrokers(updated);
                                  }}
                                  hint="Equity held up to 1 year · Taxed at 20%"
                                />
                                <Amount
                                  label="Long-term capital gain (LTCG 112A)"
                                  value={item.ltcg112A}
                                  onChange={(v) => {
                                    const updated = brokers.map((b) =>
                                      b.id === item.id ? { ...b, ltcg112A: v } : b,
                                    );
                                    setBrokers(updated);
                                    syncBrokers(updated);
                                  }}
                                  hint="Equity held > 1 year · Eligible for ₹1.25L exemption"
                                />
                              </div>
                            </div>
                          ))}

                          <button
                            className="secondary"
                            onClick={() => {
                              const updated = [
                                ...brokers,
                                {
                                  id: String(Date.now()),
                                  broker: 'Other / Custom Broker',
                                  stcg111A: 0,
                                  ltcg112A: 0,
                                },
                              ];
                              setBrokers(updated);
                            }}
                          >
                            + Add another broker
                          </button>

                          <div className="portfolio-summary-card">
                            <h4>
                              <span>Combined Portfolio Capital Gains</span>
                              <span className="tag">All Brokers</span>
                            </h4>
                            <div className="portfolio-summary-grid">
                              <div className="portfolio-stat">
                                <span>Total STCG (Sec 111A)</span>
                                <strong>
                                  {money(brokers.reduce((acc, b) => acc + (b.stcg111A || 0), 0))}
                                </strong>
                                <small>Taxed at {percent(rules.special['111A'].rate)}</small>
                              </div>
                              <div className="portfolio-stat">
                                <span>Total LTCG (Sec 112A)</span>
                                <strong>
                                  {money(brokers.reduce((acc, b) => acc + (b.ltcg112A || 0), 0))}
                                </strong>
                                <small>Combined across all accounts</small>
                              </div>
                              <div className="portfolio-stat">
                                <span>Taxable LTCG (post-exemption)</span>
                                <strong>
                                  {money(
                                    Math.max(
                                      0,
                                      brokers.reduce((acc, b) => acc + (b.ltcg112A || 0), 0) -
                                        rules.special['112A'].exemption,
                                    ),
                                  )}
                                </strong>
                                <small>After ₹1,25,000 statutory limit</small>
                              </div>
                            </div>
                          </div>

                          <p className="note">
                            Under Indian Income Tax rules, capital gains across all brokers and
                            demat accounts are aggregated. The statutory ₹1,25,000 exemption under
                            Section 112A is applied to your combined LTCG total.
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="info-line">
                            <span>ⓘ</span>
                            <span>
                              Enter computed gains, not sale proceeds. The calculator applies the
                              112A exempt tax band automatically.
                            </span>
                          </div>
                          {input.gains.map((g, i) => (
                            <div className="repeat-card" key={i}>
                              <div className="repeat-header">
                                <h3>Capital gain {i + 1}</h3>
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    update((x) => {
                                      x.gains.splice(i, 1);
                                    });
                                    setRevision((x) => x + 1);
                                  }}
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="fields">
                                <label className="field">
                                  <span>Tax category</span>
                                  <select
                                    value={g.kind}
                                    onChange={(e) =>
                                      update((x) => {
                                        x.gains[i].kind = e.target.value as Gain['kind'];
                                      })
                                    }
                                  >
                                    <option value="111A">STCG · 111A / 196</option>
                                    <option value="otherSTCG">Other STCG · normal rates</option>
                                    <option value="112A">LTCG · 112A / 198</option>
                                    <option value="112">LTCG · 112 / 197</option>
                                    <option value="otherLTCG">Other LTCG · unsupported</option>
                                  </select>
                                </label>
                                <label className="field">
                                  <span>Asset type</span>
                                  <select
                                    value={g.asset}
                                    onChange={(e) =>
                                      update((x) => {
                                        x.gains[i].asset = e.target.value as Gain['asset'];
                                      })
                                    }
                                  >
                                    <option value="equity">
                                      Listed equity / equity-oriented fund
                                    </option>
                                    <option value="property">Land / building</option>
                                    <option value="other">Other asset</option>
                                  </select>
                                </label>
                                <Amount
                                  label="Computed gain after eligible exemptions"
                                  value={g.amount}
                                  onChange={(v) =>
                                    update((x) => {
                                      x.gains[i].amount = v;
                                    })
                                  }
                                />
                                {(['acquired', 'sold'] as const).map((key) => (
                                  <label className="field" key={key}>
                                    <span>
                                      {key === 'acquired' ? 'Acquisition date' : 'Sale date'}
                                    </span>
                                    <input
                                      type="date"
                                      value={g[key]}
                                      onChange={(e) =>
                                        update((x) => {
                                          x.gains[i][key] = e.target.value;
                                        })
                                      }
                                    />
                                  </label>
                                ))}
                              </div>
                              <Check
                                checked={g.confirmed}
                                onChange={(v) =>
                                  update((x) => {
                                    x.gains[i].confirmed = v;
                                  })
                                }
                              >
                                I have checked the gain computation, classification, applicable
                                exemptions and STT conditions. The amount is before the 112A annual
                                tax band.
                              </Check>
                            </div>
                          ))}
                          <button
                            className="secondary"
                            onClick={() =>
                              update((x) => {
                                x.gains.push({
                                  kind: '111A',
                                  asset: 'equity',
                                  amount: 0,
                                  acquired: '',
                                  sold: '',
                                  confirmed: false,
                                });
                              })
                            }
                          >
                            + Add capital gain
                          </button>
                          <p className="note">
                            Pre-February 2018 equity and property acquired before 23 July 2024 are
                            blocked for grandfathering / indexation review. Mixed special-rate
                            surcharge cases above ₹50 lakh are unsupported.
                          </p>
                        </>
                      )}
                    </Panel>
                    <Panel
                      id="payments"
                      num="07"
                      title="Tax already paid"
                      caption="TDS, TCS and tax payments made for this year"
                    >
                      <div className="fields">
                        {fields('payments', {
                          tds: 'Tax deducted at source (TDS)',
                          tcs: 'Tax collected at source (TCS)',
                          advance: 'Advance tax',
                          selfAssessment: 'Self-assessment tax',
                        })}
                      </div>
                      <p className="note">
                        Use eligible credits for this tax year, reconciled with your tax records.
                      </p>
                    </Panel>
                    <Panel
                      id="scope"
                      num="08"
                      title="Other circumstances"
                      caption="Check these so we do not return an incomplete estimate"
                    >
                      <p className="note">
                        These cases need additional calculations and will withhold the estimate when
                        selected.
                      </p>
                      {Object.entries({
                        losses: 'Business / capital losses or brought-forward adjustments',
                        foreignRelief:
                          'Foreign income, treaty rates, foreign tax credits or arrears relief',
                        agricultural: 'Agricultural income',
                        otherSpecial: 'Crypto, lottery, buyback or other special-rate income',
                        otherDeductions: 'Other deductions, including 80JJAA / IFSC',
                      }).map(([key, label]) => (
                        <Check
                          key={key}
                          checked={input.unsupported[key as keyof TaxInput['unsupported']]}
                          onChange={(v) =>
                            update((x) => {
                              x.unsupported[key as keyof TaxInput['unsupported']] = v;
                            })
                          }
                        >
                          {label}
                        </Check>
                      ))}
                    </Panel>
                    <button
                      className="primary full"
                      onClick={() => {
                        setTab('breakdown');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      View full calculation <span>→</span>
                    </button>
                  </div>
                ) : result ? (
                  <Breakdown r={result} rules={rules} />
                ) : (
                  <div className="card">
                    <h2>Calculation unavailable</h2>
                    <p>
                      Resolve the flagged inputs or unsupported circumstances before viewing a
                      breakdown.
                    </p>
                    <button className="secondary" onClick={() => setTab('calculator')}>
                      ← Return to inputs
                    </button>
                  </div>
                )}
              </div>
              <aside className="results-column" aria-label="Tax estimate">
                <div className="result-card">
                  <div className="result-kicker">
                    <span>YOUR TAX ESTIMATE</span>
                    <span className="live-dot">● Live</span>
                  </div>
                  {result ? (
                    <>
                      <div className="result-label">Total tax liability</div>
                      <div className="tax-amount" aria-live="polite">
                        {whole(result.liability)}
                      </div>
                      <div className="effective">
                        <span>Effective tax rate</span>
                        <strong>{result.effectiveRate.toFixed(2)}%</strong>
                      </div>
                      <div className="tax-bar">
                        <span style={{ width: `${Math.min(100, result.effectiveRate)}%` }} />
                      </div>
                      <div className="summary-stats">
                        <div>
                          <span>Gross total income</span>
                          <strong>{whole(result.income.grossTotal)}</strong>
                        </div>
                        <div>
                          <span>Taxable income</span>
                          <strong>{whole(result.total)}</strong>
                        </div>
                      </div>
                      <div className="result-ledger">
                        <LedgerRow
                          label="Income tax before relief"
                          value={result.taxBeforeRelief}
                        />
                        <LedgerRow
                          label="Rebate + 87A marginal relief"
                          value={-result.rebate - result.rebateRelief}
                        />
                        <LedgerRow
                          label="Surcharge after relief"
                          value={result.surcharge.total - result.surchargeRelief.relief}
                        />
                        <LedgerRow
                          label={`Cess · ${percent(rules.cessRate)}`}
                          value={result.cess}
                        />
                        <LedgerRow label="Tax already paid" value={result.paid} />
                      </div>
                      <div className="payable">
                        <span>{result.net < 0 ? 'Expected refund' : 'Tax payable'}</span>
                        <strong>{whole(Math.abs(result.net))}</strong>
                      </div>
                      <p className="result-note">Before any interest, late fees or penalties.</p>
                      <button
                        className="result-link"
                        onClick={() => setTab(tab === 'breakdown' ? 'calculator' : 'breakdown')}
                      >
                        {tab === 'breakdown' ? 'Edit your income' : 'Explore calculation breakdown'}{' '}
                        <span>↗</span>
                      </button>
                    </>
                  ) : (
                    <div className="unavailable">
                      <h2>Estimate withheld</h2>
                      <p>Review the items below. No partial tax figure is shown.</p>
                    </div>
                  )}
                </div>
                {!calculation.ok && (
                  <div className="error-card" role="alert">
                    <h3>Review your inputs</h3>
                    <ul>
                      {calculation.issues.map((issue, i) => (
                        <li key={i}>
                          <strong>{issue.path}</strong>
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {calculation.ok &&
                  calculation.warnings.map((warning, i) => (
                    <div className="warning-card" key={i}>
                      {warning}
                    </div>
                  ))}
                {result && (
                  <div className="insight-card">
                    <span className="insight-icon">✦</span>
                    <h3>
                      {result.liability === 0
                        ? 'Why your estimate is zero'
                        : 'A deduction before the slabs'}
                    </h3>
                    <p>
                      {result.income.standardDeduction > 0
                        ? `Your salary standard deduction is ${whole(result.income.standardDeduction)}. `
                        : ''}
                      {result.liability === 0
                        ? result.rebate > 0
                          ? 'Your eligible resident rebate offsets your normal slab tax.'
                          : 'Your income and applicable exemptions produce no tax.'
                        : 'The estimate uses your total income, residency and any special-rate gains to determine rebate eligibility.'}
                    </p>
                    <button className="text-button" onClick={() => setTab('rules')}>
                      Read the tax rules →
                    </button>
                  </div>
                )}
                <div className="verification-note">
                  <span>✓</span>
                  <p>
                    Rules checked against official sources.
                    <br />
                    <button className="text-button" onClick={() => setTab('rules')}>
                      View verification scope
                    </button>
                  </p>
                </div>
              </aside>
            </div>
          )}
          <footer className="disclaimer">
            Income tax calculations are estimates based on the information entered and the tax rules
            configured for the selected tax year. This calculator is intended for informational
            purposes and does not constitute tax or legal advice. Please verify the final liability
            with the Income Tax Department or a qualified tax professional.
          </footer>
          <div className="print-only">
            {result && tab !== 'breakdown' && <Breakdown r={result} rules={rules} />}
          </div>
        </main>
      </div>
    </>
  );
}
