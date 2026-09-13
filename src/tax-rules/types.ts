export interface TaxRules {
  year: string;
  start: string;
  end: string;
  verifiedOn: string;
  slabs: readonly { upper: number | null; rate: number }[];
  salaryDeduction: number;
  familyPension: { divisor: number; maximum: number };
  employerContributionReviewLimit: number;
  equityGrandfatheringBefore: string;
  propertyProtectionBefore: string;
  houseDeductionRate: number;
  basicExemption: number;
  rebate: { threshold: number; maximum: number };
  special: Record<'111A' | '112A' | '112', { rate: number; exemption: number; section: string }>;
  surcharge: readonly { threshold: number; rate: number }[];
  specialSurchargeCap: number;
  cessRate: number;
  roundingUnit: number;
  deductions: Record<
    string,
    {
      section: string;
      name: string;
      maximumLimit: string;
      eligibility: string;
      regime: 'new';
      effectiveYear: string;
      rate?: number;
    }
  >;
}
