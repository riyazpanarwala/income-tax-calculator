import type { TaxRules } from '../tax-rules/types';
import { multiply } from './arithmetic';
export const calculateCess = (taxAfterRelief: number, r: TaxRules) =>
  multiply(taxAfterRelief, r.cessRate);
