import Decimal from 'decimal.js';
// Decimal rate arithmetic avoids binary artefacts such as 1,100,000 × .14.
// Keep fractional rupees; never round intermediate monetary results to display precision.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const add = (...values: number[]) =>
  values.reduce((total, value) => total.plus(value), new D(0)).toNumber();
export const subtract = (a: number, ...values: number[]) =>
  values.reduce((total, value) => total.minus(value), new D(a)).toNumber();
export const multiply = (a: number, b: number) => new D(a).times(b).toNumber();
export const divide = (a: number, b: number) => new D(a).div(b).toNumber();
export function roundStatutory(value: number, unit: number) {
  const n = new D(value).abs().trunc();
  return n
    .plus(unit / 2)
    .div(unit)
    .floor()
    .times(unit)
    .times(Math.sign(value))
    .toNumber();
}
export function roundBalance(liability: number, paid: number, unit: number) {
  const balance = new D(liability).minus(paid);
  return balance
    .abs()
    .trunc()
    .plus(unit / 2)
    .div(unit)
    .floor()
    .times(unit)
    .times(balance.isNegative() ? -1 : 1)
    .toNumber();
}
