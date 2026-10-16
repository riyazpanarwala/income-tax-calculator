# Taxfolio — Indian income-tax calculator

A React + TypeScript calculator for **FY / Tax Year 2026–27**, new regime. The deterministic engine is independent of React. Rules are versioned, every result has a detailed calculation trail, and unsupported legal cases return validation issues instead of partial tax figures.

## Run locally

Requires Node.js 22.12+ (verified with Node 24).

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the local URL printed by Vite. `npm.cmd run build` type-checks and builds `dist/`. `npm.cmd run preview` serves that build. `dist/` can be hosted as a static application; no server-side processing, account or database is needed. No deployment was requested or performed.

Income stays in React memory and is cleared when the page is refreshed. There is no analytics, storage or outbound income submission. Google Fonts may be fetched for typography; system-font fallbacks keep the app usable without them. Print creates a local calculation breakdown.

## Import salary, dividends and bank interest from Excel

Choose **Upload income Excel** above Taxpayer details, select your ITR `.xlsx` or `.xls`, review the preview, and choose **Fill income fields**. This supports the supplied monthly salary layout (Basic, HRA, CCA, Tra. All., Med. Allow, Bonus, Qua. All., Tel. All, Sp. All, Special, Arrears, Total, PT, TDS) and the side-by-side company/date/amount and bank/date/amount tables under **Dividends** (or **Dividands**) and **Interest**. Sheet positions and names may vary; keep the column labels and table structure.

The importer sums monthly components rather than using net pay or cached summary totals. HRA and the other allowances fill taxable allowances; arrears fill other taxable salary. Salary components and dividends replace the current entries. Choose savings, fixed deposits or other taxable interest; only that interest category is replaced. The optional TDS checkbox replaces **total TDS** with salary TDS, so add TDS from other sources separately. Employer contributions, business income, capital gains and other payments are preserved. Repeating the import with the same interest category replaces values without doubling them. For a mix of savings and deposit interest, split the amounts in the populated fields after importing.

The filename should identify the financial year, for example `ITR_2026-27.xlsx`. A different filename year is rejected. Conflicting salary-tab years, out-of-year transaction dates, incomplete salary months and blank transaction amounts are shown for review; confirm the year and amounts before applying them. Blank transaction amounts are excluded, and no missing months are projected. Detail formulas use Excel's saved results: recalculate and save before uploading. Summary formulas are excluded. Files stay in browser memory, and the original workbook is never changed or uploaded.

## Import Capital Gains from PortFin

1. Select the correct FY. This calculator currently supports **FY 2026-27 only**; FY 2025-26 exports are rejected.
2. In PortFin's Tax tab, select the same FY and choose **Export for Income Tax**. Verify instrument eligibility and review the gains/losses before downloading JSON.
3. Open **Capital gains → Import from PortFin** and select that JSON file.
4. Review the preview and warnings, then confirm **Import gains** or **Replace capital gains**. Merge is available for the first import only after reviewing existing broker/manual overlap.
5. Review/edit the accepted gains and continue with salary, other income, TDS and other payments. These unrelated fields are preserved.
6. Resolve all review items before relying on a result. Losses and ambiguous classifications withhold the estimate; no partial tax figure is presented. Discard can restore pre-import gains.

Repeat imports do not append duplicate gains. Files are processed locally in browser memory. See [contract, mappings and limitations](docs/PORTFIN_INTEGRATION.md). The calculator remains an estimate; verify the final return.

If your browser does not save downloads, use PortFin's **Copy JSON** (or **View JSON**) and the calculator's **Paste PortFin JSON** option. Pasted data uses the same validation and confirmation preview as files.

## Upload a Shoonya F&O statement

Open **Business / profession → Upload Shoonya F&O Excel** and choose the original `DerivativePLStatement.xlsx`. The existing broker statement uploader also detects this format and opens the F&O preview instead of putting it into capital gains.

The preview shows the report period, contract count, gross P&L, individual charges and net ledger P&L. It validates the financial year and reconciles contract rows, totals and charges. Repeated MTM/premium summaries are not added together. The file is read locally; account identifiers and the original workbook are not stored in the repository or sent to a server.

After reconciliation and explicit confirmation, a positive result can replace the business-profit field. Importing the same report again does not add it twice. Losses, brought-forward amounts and open-position valuations are retained for review and withhold the tax estimate; the current engine does not implement business-loss set-off or carry-forward. Salary, capital gains, payments and user-selected scope flags are preserved. A part-year report is clearly labelled and must not be mistaken for the final annual result.

F&O is kept separate from equity capital gains; see the Income Tax Department's [business or profession guidance](https://www.incometaxindia.gov.in/w/business-or-profession). Broker P&L still needs reconciliation with contract notes and applicable tax adjustments. Turnover, tax-audit eligibility and return filing are not calculated by this importer.

## Validation commands

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit
```

Read [tax rules](docs/TAX_CALCULATION_RULES.md) and [verification evidence](docs/VERIFICATION.md) before extending the engine or relying on a supported case. Seven live official-calculator examples were checked; the broader special-rate model is covered by statutory fixtures and documented scope guards, not an unrestricted official certification.

## Code structure

```text
src/tax-rules/               Versioned legal parameters and deduction metadata
src/tax-engine/              Validation and independently testable calculation stages
src/App.tsx                  Income-entry UI and summary dashboard
src/Breakdown.tsx            Engine-generated ledger and explanation
tests/                      Independent oracles, boundary tests and official fixtures
docs/                       Legal references, assumptions and verification record
```

Public entry point:

```ts
import { emptyInput } from './src/tax-engine/types';
import { calculateFinalTax } from './src/tax-engine/calculateFinalTax';

const input = emptyInput();
input.salary.basic = 1_500_000;
const calculation = calculateFinalTax(input);
if (calculation.ok)
  console.log(calculation.result.liability); // 97,500
else console.log(calculation.issues);
```

The public API accepts unknown input and validates its structure, enum values, monetary bounds and legal scope. Unknown fields (including attempted old-regime deductions or a manually claimed rebate) are rejected. Stage functions expect validated input and a trusted rules configuration; they are not separate external API endpoints.

Add another year by implementing `TaxRules` in a separate file and registering it in `src/tax-rules/index.ts`. Parameter changes do not require UI or algorithm changes; genuinely new legal mechanisms require new tested calculation stages. Add independent reference fixtures for each new year. Never remove an unsupported-case guard based on UI convenience.

## Supported scope

Adult individuals; salary/regular pension; computed ordinary business income; ordinary other-source income and family pension; property income with restricted set-off; employer NPS; Government Agniveer contributions; classified gains at normal, 20% and 12.5% rates; resident rebate; both marginal reliefs; supported homogeneous surcharge cases; cess; rounding; tax credits and refunds.

**Not a universal tax-return computation.** Particularly, mixed capital-gain/dividend and other income above ₹50 lakh, salary exemption calculations, losses, grandfathering, protected property indexation and treaty cases are blocked. See the rules document for the complete input contract.
