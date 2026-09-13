import type { TaxResult } from './tax-engine/calculateFinalTax';
import type { TaxRules } from './tax-rules/types';
import { money, percent } from './format';
export function LedgerRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className={`ledger-row ${strong ? 'strong' : ''}`}>
      <span>{label}</span>
      <span>{money(value)}</span>
    </div>
  );
}
export default function Breakdown({ r, rules }: { r: TaxResult; rules: TaxRules }) {
  return (
    <div className="breakdown">
      <section className="card">
        <div className="card-heading">
          <span className="step">01</span>
          <div>
            <h2>From income to taxable income</h2>
            <p>Every income head, accounted for.</p>
          </div>
        </div>
        <LedgerRow
          label="Gross salary, including employer contributions"
          value={r.income.grossSalary}
        />
        <LedgerRow label="Salary standard deduction" value={-r.income.standardDeduction} />
        <LedgerRow label="Income chargeable under salary" value={r.income.salary} />
        <LedgerRow label="House property (after restricted set-off)" value={r.income.house} />
        <LedgerRow label="Business / profession" value={r.income.business} />
        <LedgerRow
          label="Capital gains (normal + special)"
          value={r.income.ordinaryGains + r.income.specialGains}
        />
        <LedgerRow label="Other sources, after family-pension deduction" value={r.income.other} />
        <LedgerRow
          label="Family-pension deduction included above"
          value={-r.income.familyPensionDeduction}
        />
        <LedgerRow label="Gross total income" value={r.income.grossTotal} strong />
        <LedgerRow label="Eligible employer NPS deduction" value={-r.income.claimedNps} />
        <LedgerRow
          label="Eligible Government Agniveer deduction"
          value={-r.income.claimedAgniveer}
        />
        <LedgerRow
          label="Total Chapter VIII deductions applied (limited to normal income)"
          value={-r.income.deductions}
        />
        <LedgerRow label="Income rounding · section 516" value={r.incomeRounding} />
        <LedgerRow label="Total taxable income" value={r.total} strong />
        {r.income.propertyRows.map((p, i) => (
          <div className="note" key={i}>
            Property {i + 1}: net annual value {money(p.nav)} − statutory deduction{' '}
            {money(p.deduction)} − allowed interest {money(p.occupancy === 'let' ? p.interest : 0)}{' '}
            = {money(p.income)}.{' '}
            {p.occupancy === 'self' ? 'Self-occupied interest is not deducted.' : ''}
          </div>
        ))}
        {r.income.unusablePropertyLoss > 0 && (
          <p className="note">
            Unusable net property loss: {money(r.income.unusablePropertyLoss)}. It does not reduce
            other income.
          </p>
        )}
      </section>
      <section className="card">
        <div className="card-heading">
          <span className="step">02</span>
          <div>
            <h2>Your progressive slab breakdown</h2>
            <p>Normal-rate taxable income: {money(r.normal)}</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Income band</th>
                <th>Amount in band</th>
                <th>Rate</th>
                <th>Tax</th>
              </tr>
            </thead>
            <tbody>
              {r.slab.rows.map((s, i) => (
                <tr key={i} className={s.amount ? '' : 'muted'}>
                  <td>
                    {money(s.lower)} {s.upper === null ? '+' : `– ${money(s.upper)}`}
                  </td>
                  <td>{money(s.amount)}</td>
                  <td>
                    <span className="rate">{percent(s.rate)}</span>
                  </td>
                  <td>{money(s.tax)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Tax on normal income</td>
                <td>{money(r.slab.tax)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {r.special.rows.some((s) => s.amount > 0) && (
          <>
            <h3>Special-rate capital gains</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Provision</th>
                    <th>Gain</th>
                    <th>Basic adjustment</th>
                    <th>Exempt band</th>
                    <th>Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {r.special.rows
                    .filter((s) => s.amount > 0)
                    .map((s) => (
                      <tr key={s.kind}>
                        <td>
                          {s.kind} · {percent(s.rate)}
                        </td>
                        <td>{money(s.amount)}</td>
                        <td>{money(s.basicAdjustment)}</td>
                        <td>{money(s.exemption)}</td>
                        <td>{money(s.tax)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              The 112A exempt tax band remains part of total income for rebate and surcharge
              eligibility.
            </p>
          </>
        )}
      </section>
      <section className="card">
        <div className="card-heading">
          <span className="step">03</span>
          <div>
            <h2>Relief, surcharge & final liability</h2>
            <p>Applied in statutory order.</p>
          </div>
        </div>
        <LedgerRow label="Tax on normal income" value={r.slab.tax} />
        <LedgerRow label="Tax on special-rate income" value={r.special.tax} />
        <LedgerRow label="Income tax before relief" value={r.taxBeforeRelief} strong />
        <LedgerRow label="Section 87A rebate · now section 156" value={-r.rebate} />
        <LedgerRow label="87A marginal relief · now section 156" value={-r.rebateRelief} />
        <LedgerRow label="Surcharge on ordinary tax" value={r.surcharge.ordinary} />
        <LedgerRow label="Surcharge on capped gains / dividends" value={r.surcharge.capped} />
        <LedgerRow label="Surcharge marginal relief" value={-r.surchargeRelief.relief} />
        <LedgerRow label={`Health & Education Cess · ${percent(rules.cessRate)}`} value={r.cess} />
        <LedgerRow label="Tax rounding · section 516" value={r.taxRounding} />
        <LedgerRow label="Total tax liability" value={r.liability} strong />
        <LedgerRow label="Tax already paid" value={-r.paid} />
        <LedgerRow
          label={r.net < 0 ? 'Expected refund' : 'Tax payable'}
          value={Math.abs(r.net)}
          strong
        />
        <p className="note">
          The final payable/refund is independently rounded from unrounded liability less tax
          credits. Interest, fees and penalties are outside this estimate.
        </p>
        {r.surchargeRelief.relief > 0 && (
          <p className="note">
            At the {money(r.surchargeRelief.threshold!)} threshold, the tax-plus-surcharge ceiling
            including excess income is {money(r.surchargeRelief.ceiling!)}. Relief reduces your tax
            plus surcharge to this ceiling, before cess.
          </p>
        )}
      </section>
      <details className="card explanation" open>
        <summary>How was my tax calculated?</summary>
        <p>Your normal taxable income is {money(r.normal)}. Tax is calculated progressively:</p>
        {r.slab.rows
          .filter((s) => s.amount > 0)
          .map((s, i) => (
            <p key={i}>
              {i === 0 ? 'The first' : 'The next'} {money(s.amount)} is taxed at {percent(s.rate)} ={' '}
              {money(s.tax)}.
            </p>
          ))}
        <p>
          Special-rate tax is {money(r.special.tax)}. Resident rebate is {money(r.rebate)} and
          rebate marginal relief is {money(r.rebateRelief)}. Each relief is capped at eligible
          normal slab tax; the remaining tax cannot be lower than special-rate tax.
        </p>
        <p>
          Surcharge of {money(r.surcharge.total)}, less surcharge relief of{' '}
          {money(r.surchargeRelief.relief)}, is added before {percent(rules.cessRate)} cess of{' '}
          {money(r.cess)}. Statutory rounding gives a liability of {money(r.liability)}.
        </p>
      </details>
    </div>
  );
}
