import { needsGrandfathering, resolveGrandfathering, type PortFinExport } from './portfin';

export const AMFI_2018_SOURCE =
  'https://www.amfiindia.com/uploads/NAV_All_31_Jan2018_cf117d62c0.txt';
export const AMFI_2018_ASSET = 'data/amfi-nav-2018-01-31.txt';
export interface AmfiNavEntry {
  schemeCode: string;
  schemeName: string;
  isin: string;
  nav: number;
}
export interface AutomaticNav extends AmfiNavEntry {
  symbol: string;
  lots: number;
}

/** ISINs, not current scheme names or ticker aliases, identify the plan and option. */
export function parseAmfiNav(text: string): Map<string, AmfiNavEntry[]> {
  if (text.length > 5_000_000 || !text.trimStart().startsWith('Scheme Code;ISIN'))
    throw new Error('The AMFI historical NAV reference could not be read.');
  const entries = new Map<string, AmfiNavEntry[]>();
  // Some AMFI scheme names wrap onto another line. Do not split records by line.
  const records = /^\s*(\d+);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^\r\n]+)/gm;
  for (const row of text.matchAll(records)) {
    if (row[8].trim() !== '31-Jan-2018' || !/^\d+(?:\.\d+)?$/.test(row[5].trim())) continue;
    const nav = Number(row[5]);
    if (!Number.isFinite(nav) || nav <= 0 || nav > 1e12) continue;
    for (const isin of new Set([row[2], row[3]].map((v) => v.trim().toUpperCase()))) {
      if (!/^INF[A-Z0-9]{9}$/.test(isin)) continue;
      const entry = {
        schemeCode: row[1],
        schemeName: row[4].replace(/\s+/g, ' ').trim(),
        isin,
        nav,
      };
      const matches = entries.get(isin) ?? [];
      if (
        !matches.some(
          (m) =>
            m.schemeCode === entry.schemeCode && m.nav === nav && m.schemeName === entry.schemeName,
        )
      )
        matches.push(entry);
      entries.set(isin, matches);
    }
  }
  if (!entries.size) throw new Error('No usable NAV records dated 31 January 2018 were found.');
  return entries;
}

export function applyAmfiNav(data: PortFinExport, reference: Map<string, AmfiNavEntry[]>) {
  let resolved = data;
  const applied: AutomaticNav[] = [];
  const pending = data.gains.filter(needsGrandfathering);
  const keys = new Set<string>();
  for (const g of pending) {
    if (g.instrument.exchange.trim().toUpperCase() !== 'AMFI') continue;
    const isin = g.instrument.isin.trim().toUpperCase();
    const key = JSON.stringify([g.instrument.symbol, isin]);
    if (keys.has(key)) continue;
    keys.add(key);
    // PortFin's precise grandfathering reason comes after its equity/STT checks.
    // AMFI NAV is used only for mutual-fund units, never an exchange-listed stock/ETF.
    const matches = reference.get(isin);
    if (!matches || matches.length !== 1) continue;
    const entry = matches[0];
    const lots = pending.filter(
      (lot) =>
        lot.instrument.symbol === g.instrument.symbol &&
        lot.instrument.isin.trim().toUpperCase() === isin &&
        lot.instrument.exchange.trim().toUpperCase() === 'AMFI',
    ).length;
    const source = `AMFI NAV — 31-Jan-2018; ISIN ${isin}; NAV per unit ${entry.nav}; ${AMFI_2018_SOURCE}`;
    resolved = resolveGrandfathering(resolved, g.instrument.symbol, entry.nav, source, true, isin);
    applied.push({ ...entry, symbol: g.instrument.symbol, lots });
  }
  return { data: resolved, applied };
}

let referencePromise: Promise<Map<string, AmfiNavEntry[]>> | undefined;
export function loadAmfiNav() {
  // The public reference is shipped with the app: no income or ISIN is sent to AMFI.
  referencePromise ??= fetch(new URL(AMFI_2018_ASSET, document.baseURI))
    .then(async (response) => {
      if (!response.ok) throw new Error('Historical NAV reference is unavailable.');
      return parseAmfiNav(await response.text());
    })
    .catch((cause) => {
      referencePromise = undefined;
      throw cause;
    });
  return referencePromise;
}
