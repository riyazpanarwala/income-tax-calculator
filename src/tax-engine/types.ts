export type Residency = 'resident' | 'rnor' | 'non-resident';
export type GainKind = '111A' | 'otherSTCG' | '112A' | '112' | 'otherLTCG';
export interface Gain {
  kind: GainKind;
  amount: number;
  acquired: string;
  sold: string;
  asset: 'equity' | 'property' | 'other';
  confirmed: boolean;
}
export interface TaxInput {
  year: string;
  taxpayer: 'individual';
  residency: Residency;
  age: number;
  salary: {
    basic: number;
    da: number;
    bonus: number;
    commission: number;
    allowances: number;
    perquisites: number;
    other: number;
    employerNps: number;
    npsEligibleDa: number;
    agniveerGovernment: number;
    isAgniveer: boolean;
  };
  properties: {
    occupancy: 'self' | 'let';
    annualValue: number;
    municipalTaxes: number;
    interest: number;
  }[];
  business: number;
  other: {
    savings: number;
    deposits: number;
    dividends: number;
    familyPension: number;
    interest: number;
    ordinary: number;
  };
  gains: Gain[];
  payments: { tds: number; tcs: number; advance: number; selfAssessment: number };
  unsupported: {
    salaryExemptions: boolean;
    losses: boolean;
    foreignRelief: boolean;
    agricultural: boolean;
    otherSpecial: boolean;
    otherDeductions: boolean;
  };
}
export interface Issue {
  path: string;
  message: string;
}
export const emptyInput = (): TaxInput => ({
  year: '2026-27',
  taxpayer: 'individual',
  residency: 'resident',
  age: 30,
  salary: {
    basic: 0,
    da: 0,
    bonus: 0,
    commission: 0,
    allowances: 0,
    perquisites: 0,
    other: 0,
    employerNps: 0,
    npsEligibleDa: 0,
    agniveerGovernment: 0,
    isAgniveer: false,
  },
  properties: [],
  business: 0,
  other: { savings: 0, deposits: 0, dividends: 0, familyPension: 0, interest: 0, ordinary: 0 },
  gains: [],
  payments: { tds: 0, tcs: 0, advance: 0, selfAssessment: 0 },
  unsupported: {
    salaryExemptions: false,
    losses: false,
    foreignRelief: false,
    agricultural: false,
    otherSpecial: false,
    otherDeductions: false,
  },
});
