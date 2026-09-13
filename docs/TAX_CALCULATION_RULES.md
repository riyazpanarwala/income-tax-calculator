# Tax calculation rules — FY / Tax Year 2026–27

Source review and live calculator comparison: **13 September 2026**.

This release is a bounded estimator for adult individuals. Unsupported circumstances withhold the entire estimate, as required by the specification. It is not a tax-return preparation system, and it is not a claim of coverage of every provision of Indian tax law.

## Year and legal references

Tax year 2026–27 runs from 1 April 2026 to 31 March 2027 under the Income-tax Act, 2025. Do not confuse it with assessment year 2026–27 under the 1961 Act. The current official calculator has an explicit 2025 Act mode and a Tax year 2026–27 selector.

| Familiar 1961 Act reference | Current provision | Purpose                            |
| --------------------------- | ----------------- | ---------------------------------- |
| 115BAC                      | 202               | New regime                         |
| 16(ia)                      | 19                | Salary standard deduction          |
| 24                          | 22                | House-property deductions          |
| 57(iia)                     | 93(1)(d)          | Family-pension deduction           |
| 80CCD(2)                    | 124(1)–(2)        | Employer pension contribution      |
| 80CCH(2)                    | 125(2)            | Government Agniveer contribution   |
| 87A                         | 156               | Rebate and rebate marginal relief  |
| 111A                        | 196               | Specified short-term capital gains |
| 112                         | 197               | General long-term capital gains    |
| 112A                        | 198               | Specified equity long-term gains   |
| 288A / 288B                 | 516               | Rounding                           |

The familiar names in the UI are aliases, not a claim that the repealed section numbering governs this tax year.

## Slabs

| Normal taxable income band    | Rate |
| ----------------------------- | ---: |
| First ₹4,00,000               |   0% |
| Next ₹4,00,000, to ₹8,00,000  |   5% |
| Next ₹4,00,000, to ₹12,00,000 |  10% |
| Next ₹4,00,000, to ₹16,00,000 |  15% |
| Next ₹4,00,000, to ₹20,00,000 |  20% |
| Next ₹4,00,000, to ₹24,00,000 |  25% |
| Excess over ₹24,00,000        |  30% |

Source: [section 202](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-202-78). Bands are continuous monetary intervals: a row beginning at ₹4 lakh means the amount **above** ₹4 lakh. Age does not change these slabs.

## Income and permitted deductions

Salary components and employer NPS / Government Agniveer contributions are added once. The standard deduction is the smaller of salary and ₹75,000. Employer contributions must not also be entered in other salary. Ordinary employment pension belongs in salary; family pension is a separate other-source input. See [section 19](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-19-199) and [salary definition in section 16](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-16-220).

Let-out annual value is supplied by the user after determining the applicable rent / expected-rent / vacancy treatment. Owner-paid municipal taxes reduce it; 30% of the resulting annual value and permitted borrowing interest are deducted. Self-occupied interest is disallowed. Property results are aggregated within that head; a net loss is not offset against salary or other heads. No carry-forward benefit is estimated under section 202(3). More than two self-occupied properties and municipal taxes exceeding entered annual value require additional treatment and are blocked. Sources: [section 22](https://www.incometaxindia.gov.in/w/section-22-211) and section 202.

Business income must be a previously computed non-negative taxable profit under the new regime. This application does not derive profit from turnover, calculate presumptive income or depreciation, or validate an expense schedule.

Savings, deposit interest, ordinary dividends and other ordinary taxable income are combined after deducting the lesser of one-third of family pension and ₹25,000. Non-resident dividends are blocked because a normal-rate dividend input is inadequate for that case. Other non-resident amounts must already be identified as taxable in India and eligible for the selected ordinary-rate treatment.

The explicit Chapter VIII whitelist consists of employer NPS, capped at 14% of basic salary plus eligible DA, and the eligible Government Agniveer contribution. Government contribution eligibility must be confirmed. Both contributions enter salary first. Deductions cannot exceed available normal income and cannot reduce specified special capital gains. The NPS excess remains taxable; a contribution beyond the configured ₹7.5 lakh perquisite-review limit blocks the estimate. Combined PF/superannuation excess and accretion must be separately computed and entered as taxable perquisites. No 80C, 80D, personal NPS or employee Agniveer deduction is admitted. Other potentially permitted provisions, such as 80JJAA / section 146 and IFSC provisions, are explicitly unsupported.

Sources: [consolidated 2025 Act amended by Finance Act 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf), sections 93, 124, 125 and 202; [section 125](https://www.incometaxindia.gov.in/w/section-125-93). Deduction metadata is in `src/tax-rules/2026-27.ts`.

Salary exemptions are not guessed or accepted as an unrestricted subtraction. A user who needs any such exemption selects the unsupported-circumstances flag and receives no estimate. This includes potentially permitted exemptions that need further eligibility inputs, not just exemptions prohibited in the new regime.

## Capital gains

The inputs are **computed gains, not proceeds**. The user confirms cost basis, classification, eligible transaction exemptions and applicable STT conditions. Each entry includes acquisition and sale dates. Sales outside the tax year, impossible dates and contradictory supported holding periods are rejected.

| Category   | Treatment                                 |
| ---------- | ----------------------------------------- |
| 111A / 196 | 20%                                       |
| Other STCG | Normal slab rates                         |
| 112A / 198 | 12.5% after the annual ₹1,25,000 tax band |
| 112 / 197  | 12.5% for confirmed eligible general LTCG |
| Other LTCG | Unsupported; no assumed rate              |

Residents, including RNOR individuals, may use otherwise unused basic exemption against eligible special gains. Non-residents do not get that adjustment. For 112A, basic exemption is adjusted before applying the ₹1,25,000 tax band. That tax band remains part of total income for rebate and surcharge eligibility; it is not an income deduction. Its limit is aggregated once across all entries.

Multiple special categories with unused resident basic exemption are blocked because allocation is not verified. Multiple special categories can be computed when normal income has exhausted basic exemption and surcharge is inapplicable. The engine does not derive grandfathered cost, asset-specific exemptions, deemed capital gains, tax treaty treatment or the protected indexed-property tax comparison. It blocks pre-February 2018 equity and property acquired before 23 July 2024. Other asset classifications, such as deemed STCG on debt instruments, must be resolved before entry.

Sources: [ITD capital-gains guide](https://www.incometaxindia.gov.in/w/capital-gain), [section 198](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-198-76), and consolidated Act sections 196–198. No old transfer-date rate is needed for a supported sale within this tax year.

## Rebate and its marginal relief

For resident individuals at total income up to ₹12 lakh, the rebate is limited to the smaller of ₹60,000 and normal slab tax. For total income above ₹12 lakh, compute:

```text
min(normal slab tax,
    max(0, normal slab tax + special tax − (total income − ₹12 lakh)))
```

This follows the total-tax comparison in section 156(2)(b), followed by the normal-tax cap in section 156(3). It is not simply a rebate on all special-rate taxes, nor is the comparison restricted to slab tax alone. Tax after this relief cannot be less than the special tax. Non-residents get neither rebate nor rebate marginal relief. Source: [section 156](https://www.incometaxindia.gov.in/w/section-156-88).

₹12.75 lakh salary yields zero tax only if the actual standard deduction, other income, residence and special-income treatment lead to that result. The UI calculates the result rather than guaranteeing a gross-salary exemption.

## Surcharge, its marginal relief, and cess

Thresholds are strictly greater than ₹50 lakh, ₹1 crore and ₹2 crore; rates are 10%, 15% and at most 25%. Specified capital gains and dividends have a 15% surcharge cap. The 25% threshold test excludes those amounts: special gains or dividends alone do not push ordinary tax to 25%.

The surcharge module allocates capped and uncapped tax separately. End-to-end surcharge is supported for ordinary income without dividends or special gains, dividend-only income, and a single special-gain category without other income. **Mixed dividend / special-rate surcharge cases above ₹50 lakh are blocked**, because the composition of hypothetical threshold income has not been independently established. The module's allocation tests do not imply end-to-end support for those cases.

For supported compositions, the engine recomputes tax plus applicable surcharge at the current bracket's lower threshold. Relief is the excess of actual tax plus surcharge over that threshold amount plus excess income, limited to the surcharge. It is separate from rebate marginal relief. Cess is 4% of tax plus surcharge after both forms of relief.

Source: [enacted Finance Act, 2026](https://www.incometaxindia.gov.in/documents/d/guest/finance-act-2026-pdf-1), section 3, especially PDF pages 13–15 for surcharge and marginal relief, and its advance-tax provisions for TY 2026–27. The consolidated Act and Finance Act, rather than Budget proposals alone, govern the configuration.

## Rounding and numeric scope

Section 516 first discards paise, then rounds total income to the nearest ₹10, with five rupees rounded upward. Eligibility tests use rounded total income. The engine reconciles that adjustment against the ordinary-income portion; with no ordinary income, it reconciles against the sole special category. Ambiguous multiple-special rounding, or a reduction larger than the available ordinary portion, blocks the result.

Rate operations use decimal.js at 40-digit precision; public stage results are JavaScript numbers, with fractional rupees retained. Inputs accept at most two decimal places. Individual amounts and aggregate income are bounded at ₹1 lakh crore. Amounts outside the numeric domain are rejected, not clamped. Family-pension thirds retain fractional rupees. Display formatting does not feed back into tax calculations.

Liability is rounded after cess. The payable/refund is independently rounded from **unrounded liability minus eligible payments**, avoiding double rounding. TDS, TCS, advance and self-assessment tax are credits, not income deductions. A negative final balance is displayed as a positive expected refund. Tax-credit availability, interest, filing fees and penalties are outside scope. Source: consolidated Act, section 516.

## Release verification

See [VERIFICATION.md](VERIFICATION.md) for live official-calculator outputs, presentation differences, test commands and the scope of the evidence. Unit tests are not a substitute for statutory review of new categories. Add a new rules file and registry entry for another year with the same supported mechanics; new legal mechanics require engine changes and new independent evidence.
