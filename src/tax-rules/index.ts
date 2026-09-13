import { rules2026 } from './2026-27';
import type { TaxRules } from './types';
export const taxYears: Record<string, TaxRules> = { [rules2026.year]: rules2026 };
