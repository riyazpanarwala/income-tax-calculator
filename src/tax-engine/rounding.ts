import { roundStatutory } from './arithmetic';
// Section 516: discard paise, then round to the nearest ten rupees.
export function statutoryRound(value: number, unit = 10) {
  return roundStatutory(value, unit);
}
