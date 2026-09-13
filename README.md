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

## Verification

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
