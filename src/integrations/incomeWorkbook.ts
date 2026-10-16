import * as XLSX from 'xlsx';
import type { TaxInput } from '../tax-engine/types';

export type InterestCategory = 'savings' | 'deposits' | 'interest';
export interface IncomeWorkbook {
  fileName: string;
  financialYear?: string;
  months: number;
  salary: { basic: number; bonus: number; allowances: number; other: number };
  tds: number;
  dividends: number;
  interest: number;
  dividendEntries: number;
  interestEntries: number;
  warnings: string[];
}
const normalize = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const round = (n: number) => Number(n.toFixed(2));
const monthNames = [
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
  'jan',
  'feb',
  'mar',
];

function amount(value: unknown, location: string): number {
  if (value === '' || value === undefined || value === null) return 0;
  const cleaned = typeof value === 'number' ? value : String(value).replace(/[₹,\s]/g, '');
  if (
    cleaned === '' ||
    !Number.isFinite(Number(cleaned)) ||
    Number(cleaned) < 0 ||
    Number(cleaned) > 1e12
  )
    throw new Error(`Invalid amount at ${location}. Enter a non-negative number in Excel.`);
  return Number(cleaned);
}

/** Read only the supported tables. Workbook text is data, never executable instructions. */
export function parseIncomeWorkbook(workbook: XLSX.WorkBook, fileName: string): IncomeWorkbook {
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    sheet: workbook.Sheets[name],
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      defval: '',
      blankrows: true,
      range: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: XLSX.utils.decode_range(workbook.Sheets[name]['!ref'] ?? 'A1').e,
      }),
    }),
  }));
  const salaries = sheets.filter((s) =>
    s.rows.some(
      (r) => r.some((v) => normalize(v) === 'basic') && r.some((v) => normalize(v) === 'tds'),
    ),
  );
  const incomes = sheets.filter((s) =>
    s.rows.some(
      (r) =>
        r.some((v) => /^(dividends|dividands)$/.test(normalize(v))) &&
        r.some((v) => normalize(v) === 'interest'),
    ),
  );
  if (salaries.length !== 1 || incomes.length !== 1)
    throw new Error(
      'Expected one monthly salary table (Basic, Bonus, TDS) and one Dividend & Interest table in your ITR workbook.',
    );
  const salary = salaries[0],
    income = incomes[0];
  const headerIndex = salary.rows.findIndex(
    (r) => r.some((v) => normalize(v) === 'basic') && r.some((v) => normalize(v) === 'tds'),
  );
  const header = salary.rows[headerIndex].map(normalize);
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0 || header.lastIndexOf(name) !== index)
      throw new Error(`Missing or duplicate salary column: ${name}.`);
    return index;
  };
  const basic = column('basic'),
    bonus = column('bonus'),
    tds = column('tds'),
    total = column('total');
  const allowanceColumns = [
    'hra',
    'cca',
    'traall',
    'medallow',
    'quaall',
    'telall',
    'spall',
    'special',
  ].map(column);
  const arrears = column('arrears');
  const start = Math.min(basic, bonus, ...allowanceColumns, arrears);
  const known = new Set([basic, bonus, ...allowanceColumns, arrears]);
  if (Array.from({ length: total - start }, (_, i) => start + i).some((c) => !known.has(c)))
    throw new Error(
      'Unrecognized salary component. Use the supported salary columns so all gross income is included.',
    );
  const result: IncomeWorkbook = {
    fileName,
    months: 0,
    salary: { basic: 0, bonus: 0, allowances: 0, other: 0 },
    tds: 0,
    dividends: 0,
    interest: 0,
    dividendEntries: 0,
    interestEntries: 0,
    warnings: [],
  };
  const fileYear = /(?:^|\D)(20\d{2})[-_](\d{2})(?!\d)/.exec(fileName);
  if (fileYear && Number(fileYear[2]) === (Number(fileYear[1]) + 1) % 100)
    result.financialYear = `${fileYear[1]}-${fileYear[2]}`;
  const tabYear = /(\d{2,4})\s*[-–]\s*(\d{2,4})/.exec(salary.name);
  if (
    tabYear &&
    result.financialYear &&
    `${tabYear[1].slice(-2)}-${tabYear[2].slice(-2)}` !== result.financialYear.slice(2)
  )
    result.warnings.push(
      `Salary tab “${salary.name}” conflicts with the filename year. Confirm which financial year these amounts belong to.`,
    );
  if (!result.financialYear)
    result.warnings.push(
      'The filename does not identify a financial year. Confirm the selected tax year before importing.',
    );
  let cachedFormula = false;
  const read = (s: typeof salary, r: number, c: number) => {
    const address = XLSX.utils.encode_cell({ r, c });
    const cell = s.sheet[address];
    if (cell?.t === 'e' || (cell?.f && (cell.v === undefined || cell.v === null || cell.v === '')))
      throw new Error(
        `Missing or erroneous formula result at ${s.name}!${address}. Recalculate and save the workbook in Excel first.`,
      );
    if (cell?.f) cachedFormula = true;
    return amount(s.rows[r]?.[c], `${s.name}!${address}`);
  };
  const seen = new Set<string>();
  salary.rows.forEach((row, r) => {
    if (r <= headerIndex) return;
    const label = normalize(row[basic - 1]);
    const month =
      /^(apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|jan(uary)?|feb(ruary)?|mar(ch)?)$/.test(
        label,
      )
        ? monthNames.find((m) => label.startsWith(m))
        : undefined;
    if (!month) {
      if (label && label !== 'total' && label !== 'grandtotal')
        throw new Error(
          `Unrecognized salary row “${String(row[basic - 1])}”. Use month names April to March.`,
        );
      if (!label && [...known, tds].some((c) => row[c] !== '' && row[c] !== undefined))
        throw new Error('A salary amount has no month label. Add its month before importing.');
      return;
    }
    if (seen.has(month)) throw new Error(`Duplicate salary month: ${month}.`);
    seen.add(month);
    result.months++;
    result.salary.basic += read(salary, r, basic);
    result.salary.bonus += read(salary, r, bonus);
    result.salary.allowances += allowanceColumns.reduce((sum, c) => sum + read(salary, r, c), 0);
    result.salary.other += read(salary, r, arrears);
    result.tds += read(salary, r, tds);
  });
  if (!result.months) throw new Error('No monthly salary rows found.');
  if (result.months < 12)
    result.warnings.push(
      `Only ${result.months} salary months are present; missing months are not projected.`,
    );
  const sectionRow = income.rows.findIndex((r) =>
    r.some((v) => /^(dividends|dividands)$/.test(normalize(v))),
  );
  const section = income.rows[sectionRow];
  const dividendColumn = section.findIndex((v) => /^(dividends|dividands)$/.test(normalize(v)));
  const interestColumn = section.findIndex((v) => normalize(v) === 'interest');
  // Each section is a three-column source / date / amount table in this template.
  for (const [kind, c] of [
    ['dividends', dividendColumn],
    ['interest', interestColumn],
  ] as const) {
    let missing = 0;
    for (let r = sectionRow + 1; r < income.rows.length; r++) {
      const row = income.rows[r];
      const source = normalize(row[c]);
      if (['total', 'grandtotal', 'taxableincome'].includes(source)) break;
      const value = row[c + 2];
      if (!source) {
        // Formula-only summary amounts are deliberately excluded.
        if (
          value !== '' &&
          value !== undefined &&
          !income.sheet[XLSX.utils.encode_cell({ r, c: c + 2 })]?.f
        )
          throw new Error(
            `An amount in ${kind} has no company/bank name. Label the entry before importing.`,
          );
        continue;
      }
      if (value === '' || value === undefined) {
        const cell = income.sheet[XLSX.utils.encode_cell({ r, c: c + 2 })];
        if (cell?.f || cell?.t === 'e') read(income, r, c + 2);
        missing++;
        continue;
      }
      result[kind] += read(income, r, c + 2);
      if (kind === 'dividends') result.dividendEntries++;
      else result.interestEntries++;
      const dateCell = income.sheet[XLSX.utils.encode_cell({ r, c: c + 1 })];
      if (dateCell?.t === 'n' && result.financialYear) {
        const date = XLSX.SSF.parse_date_code(dateCell.v);
        if (date && date.y - (date.m < 4 ? 1 : 0) !== Number(result.financialYear.slice(0, 4))) {
          const warning =
            'Some dividend or interest dates fall outside the filename financial year. Confirm these entries belong to the selected tax year.';
          if (!result.warnings.includes(warning)) result.warnings.push(warning);
        }
      }
    }
    if (missing)
      result.warnings.push(
        `${missing} ${kind} entries have blank amounts and are excluded. Fill them in Excel and re-upload when available.`,
      );
  }
  for (const key of ['basic', 'bonus', 'allowances', 'other'] as const)
    result.salary[key] = round(result.salary[key]);
  result.tds = round(result.tds);
  result.dividends = round(result.dividends);
  result.interest = round(result.interest);
  if (cachedFormula)
    result.warnings.push(
      'Some detail amounts use saved formula results. Recalculate and save in Excel before uploading if inputs changed.',
    );
  return result;
}

export async function readIncomeWorkbook(file: File): Promise<IncomeWorkbook> {
  if (!/\.xlsx?$/i.test(file.name)) throw new Error('Choose an .xlsx or .xls workbook.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a workbook smaller than 10 MB.');
  return parseIncomeWorkbook(XLSX.read(await file.arrayBuffer(), { type: 'array' }), file.name);
}

export function applyIncomeWorkbook(
  input: TaxInput,
  imported: IncomeWorkbook,
  category: InterestCategory,
  replaceTds: boolean,
): TaxInput {
  if (imported.financialYear && imported.financialYear !== input.year)
    throw new Error('Workbook year does not match the selected tax year.');
  const next = structuredClone(input);
  Object.assign(next.salary, imported.salary, { da: 0, commission: 0, perquisites: 0 });
  next.other.dividends = imported.dividends;
  next.other[category] = imported.interest;
  if (replaceTds) next.payments.tds = imported.tds;
  return next;
}
