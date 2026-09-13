import { emptyInput, type TaxInput, type Issue } from './types';
import type { TaxRules } from '../tax-rules/types';
const MAX = 1_000_000_000_000;
const gainShape = { kind: '', amount: 0, acquired: '', sold: '', asset: '', confirmed: false };
const propertyShape = { occupancy: '', annualValue: 0, municipalTaxes: 0, interest: 0 };
export function validateShape(value: unknown): Issue[] {
  const issues: Issue[] = [];
  function walk(v: unknown, t: unknown, path: string) {
    if (Array.isArray(t)) {
      if (!Array.isArray(v) || v.length > 100) {
        issues.push({ path, message: 'Expected a list with at most 100 entries.' });
        return;
      }
      v.forEach((entry, n) =>
        walk(entry, path === 'gains' ? gainShape : propertyShape, `${path}.${n}`),
      );
      return;
    }
    if (t !== null && typeof t === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        issues.push({ path, message: 'Required input object is missing.' });
        return;
      }
      const obj = v as Record<string, unknown>,
        template = t as Record<string, unknown>;
      Object.keys(obj)
        .filter((k) => !Object.hasOwn(template, k))
        .forEach((k) =>
          issues.push({
            path: `${path}.${k}`,
            message: 'Unknown field or unavailable deduction; no estimate was calculated.',
          }),
        );
      Object.entries(template).forEach(([k, x]) => walk(obj[k], x, path ? `${path}.${k}` : k));
      return;
    }
    if (
      typeof v !== typeof t ||
      (typeof v === 'number' &&
        (!Number.isFinite(v) || v < 0 || v > MAX || Number(v.toFixed(2)) !== v))
    )
      issues.push({
        path,
        message: 'Enter a non-negative amount up to ₹1 lakh crore with at most two decimal places.',
      });
  }
  walk(value, emptyInput(), '');
  return issues;
}
const dateValid = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
export function validate(input: TaxInput, r: TaxRules): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (input.taxpayer !== 'individual') add('taxpayer', 'Only individual taxpayers are supported.');
  if (!['resident', 'rnor', 'non-resident'].includes(input.residency))
    add('residency', 'Choose a valid residential status.');
  if (!Number.isInteger(input.age) || input.age < 18 || input.age > 120)
    add('age', 'Enter an age from 18 to 120. Minor income and clubbing rules are unsupported.');
  if (input.salary.npsEligibleDa > input.salary.da)
    add('salary.npsEligibleDa', 'Eligible DA cannot exceed total DA.');
  if (input.salary.agniveerGovernment > 0 && !input.salary.isAgniveer)
    add('salary.isAgniveer', 'Government Agniveer contributions require Agnipath eligibility.');
  if (input.salary.employerNps > r.employerContributionReviewLimit)
    add(
      'salary.employerNps',
      'Combined employer contribution perquisite rules above the configured limit need separate review; this case is unsupported.',
    );
  if (input.residency === 'non-resident' && input.other.dividends > 0)
    add(
      'other.dividends',
      'Non-resident dividends require special-rate or treaty computation and are unsupported.',
    );
  const labels: Record<string, string> = {
    salaryExemptions:
      'Salary exemptions (including gratuity, leave encashment and permitted duty allowances)',
    losses: 'Business/capital losses and brought-forward loss adjustments',
    foreignRelief: 'Foreign income, treaty rates, tax credits and arrears relief',
    agricultural: 'Agricultural income and partial integration',
    otherSpecial: 'Other special-rate income, including crypto, lottery winnings and buybacks',
    otherDeductions: 'Other deductions, including 80JJAA and IFSC provisions',
  };
  for (const [key, on] of Object.entries(input.unsupported))
    if (on)
      add(
        `unsupported.${key}`,
        `${labels[key]} require additional computation and are unsupported. An estimate is withheld.`,
      );
  input.properties.forEach((p, i) => {
    if (!['self', 'let'].includes(p.occupancy))
      add(`properties.${i}.occupancy`, 'Choose self-occupied or let-out.');
    if (p.occupancy === 'self' && (p.annualValue > 0 || p.municipalTaxes > 0))
      add(
        `properties.${i}`,
        'Self-occupied property must have zero annual value and municipal-tax claim.',
      );
    if (p.occupancy === 'let' && p.municipalTaxes > p.annualValue)
      add(
        `properties.${i}.municipalTaxes`,
        'Municipal taxes exceeding annual value require review and are unsupported.',
      );
  });
  if (input.properties.filter((p) => p.occupancy === 'self').length > 2)
    add(
      'properties',
      'More than two self-occupied properties requires deemed-let-out computation.',
    );
  input.gains.forEach((g, i) => {
    const path = `gains.${i}`;
    if (!['111A', 'otherSTCG', '112A', '112', 'otherLTCG'].includes(g.kind))
      add(path, 'Choose a recognised capital-gain category.');
    if (!['equity', 'property', 'other'].includes(g.asset)) add(path, 'Choose a valid asset type.');
    if (g.kind === 'otherLTCG')
      add(
        path,
        'Other LTCG is unsupported. Have the applicable special provision identified before calculating.',
      );
    if (g.amount === 0 && !g.acquired && !g.sold) return;
    if (g.amount > 0 && !g.confirmed)
      add(
        path,
        'Confirm the gain is already computed under the selected provision, with any eligible exemption and STT conditions checked.',
      );
    if (
      !dateValid(g.acquired) ||
      !dateValid(g.sold) ||
      g.acquired > g.sold ||
      g.sold < r.start ||
      g.sold > r.end
    )
      add(
        path,
        'Enter valid acquisition and sale dates; sale must fall within the selected tax year.',
      );
    if (['111A', '112A'].includes(g.kind) && g.asset !== 'equity')
      add(path, 'This category supports eligible listed equity / equity-oriented funds only.');
    if (g.kind === '112' && g.asset === 'equity')
      add(
        path,
        'Listed equity must use its applicable equity category; other equity cases are unsupported.',
      );
    if (g.kind === '112A' && g.acquired < r.equityGrandfatheringBefore)
      add(path, 'This equity requires grandfathering. This transaction is unsupported.');
    if (g.kind === '112' && g.asset === 'property' && g.acquired < r.propertyProtectionBefore)
      add(
        path,
        'This property needs the protected indexed-tax comparison. This transaction is unsupported.',
      );
    if (g.kind === '112' && g.asset === 'other' && !g.confirmed)
      add(path, 'Confirm this asset is eligible for the general 12.5% LTCG rate.');
    if (
      dateValid(g.acquired) &&
      dateValid(g.sold) &&
      g.asset === 'equity' &&
      ['111A', '112A', 'otherSTCG'].includes(g.kind)
    ) {
      const anniversary = new Date(g.acquired);
      anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
      const long = g.sold > anniversary.toISOString().slice(0, 10);
      if ((g.kind === '112A') !== long)
        add(path, 'Holding period contradicts the selected listed-equity STCG/LTCG category.');
    }
    if (
      ['112', 'otherSTCG'].includes(g.kind) &&
      g.asset === 'property' &&
      dateValid(g.acquired) &&
      dateValid(g.sold)
    ) {
      const anniversary = new Date(g.acquired);
      anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 2);
      const isLong = g.sold > anniversary.toISOString().slice(0, 10);
      if ((g.kind === '112') !== isLong)
        add(path, 'Holding period contradicts the selected property STCG/LTCG category.');
    }
  });
  return issues;
}
