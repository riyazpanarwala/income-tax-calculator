export const money = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n === 0 ? 0 : n);
export const whole = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
export const percent = (n: number) =>
  `${(n * 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
export const inputNumber = (n: number) =>
  n
    ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, useGrouping: true }).format(n)
    : '';
export function parseAmount(text: string): number {
  const valid =
    /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})?$/.test(text) ||
    /^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{0,2})?$/.test(text);
  return valid ? (text === '' ? 0 : Number(text.replaceAll(',', ''))) : NaN;
}
