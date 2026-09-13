import * as XLSX from 'xlsx';

export interface ParsedBrokerResult {
  success: boolean;
  brokerName: string;
  fileName: string;
  stcg111A: number;
  ltcg112A: number;
  details?: string;
  error?: string;
}

export const KNOWN_BROKERS = [
  { id: 'religare', name: 'Religare Broking', fileRegex: /religare/i, textRegex: /\breligare\b/i },
  {
    id: 'shoonya',
    name: 'Shoonya (Finvasia)',
    fileRegex: /shoonya|finvasia|prism/i,
    textRegex: /\b(shoonya|finvasia|prism)\b/i,
  },
  {
    id: 'groww',
    name: 'Groww',
    fileRegex: /groww|nextbillion/i,
    textRegex: /\b(groww|nextbillion)\b/i,
  },
  {
    id: 'zerodha',
    name: 'Zerodha',
    fileRegex: /zerodha|kite|console/i,
    textRegex: /\b(zerodha|kite)\b/i,
  },
  {
    id: 'upstox',
    name: 'Upstox',
    fileRegex: /upstox|rksv/i,
    textRegex: /\b(upstox|rksv)\b/i,
  },
  {
    id: 'angel',
    name: 'Angel One',
    fileRegex: /angel[\s_-]*one|angelbroking/i,
    textRegex: /\bangel[\s_-]*(one|broking)\b/i,
  },
  {
    id: 'icici',
    name: 'ICICI Direct',
    fileRegex: /icici[\s_-]*direct/i,
    textRegex: /\bicici[\s_-]*direct\b/i,
  },
  {
    id: 'hdfc',
    name: 'HDFC Sky / Securities',
    fileRegex: /hdfc[\s_-]*(sky|sec)/i,
    textRegex: /\bhdfc[\s_-]*(sky|securities)\b/i,
  },
  {
    id: 'dhan',
    name: 'Dhan',
    fileRegex: /dhan|raise/i,
    textRegex: /\bdhan\b/i,
  },
  {
    id: 'kotak',
    name: 'Kotak Securities',
    fileRegex: /kotak[\s_-]*(sec|neo|cherry)/i,
    textRegex: /\bkotak[\s_-]*(securities|neo|cherry)\b/i,
  },
  {
    id: 'motilal',
    name: 'Motilal Oswal',
    fileRegex: /motilal|mosl/i,
    textRegex: /\bmotilal\b/i,
  },
  {
    id: '5paisa',
    name: '5paisa',
    fileRegex: /5paisa/i,
    textRegex: /\b5paisa\b/i,
  },
  {
    id: 'paytm',
    name: 'Paytm Money',
    fileRegex: /paytm[\s_-]*money/i,
    textRegex: /\bpaytm[\s_-]*money\b/i,
  },
] as const;

function parseNumeric(val: unknown): number | null {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const cleaned = val.replace(/[₹$,\s"']/g, '').trim();
    if (!cleaned) return null;
    const parenMatch = cleaned.match(/^\((.*)\)$/);
    const numStr = parenMatch ? `-${parenMatch[1]}` : cleaned;
    const num = Number(numStr);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function detectBrokerName(fileName: string, headerText: string): string {
  for (const b of KNOWN_BROKERS) {
    if (b.fileRegex.test(fileName)) {
      return b.name;
    }
  }
  for (const b of KNOWN_BROKERS) {
    if (b.textRegex.test(headerText)) {
      return b.name;
    }
  }
  return 'Other / Custom Broker';
}

interface ExtractionCandidate {
  stcg: number;
  ltcg: number;
  foundSummary: boolean;
  rowsMatched: number;
}

function isTableHeaderRow(row: unknown[]): boolean {
  let tableKeywords = 0;
  for (const item of row) {
    const s = String(item || '')
      .trim()
      .toLowerCase();
    if (
      /^(scrip|symbol|security|stock|isin|buy[\s_-]*date|purchase[\s_-]*date|sell[\s_-]*date|sale[\s_-]*date|quantity|qty)$/i.test(
        s,
      )
    ) {
      tableKeywords++;
    }
  }
  return tableKeywords >= 1;
}

export function parseWorkbookData(workbook: XLSX.WorkBook, fileName: string): ParsedBrokerResult {
  let headerText = '';
  let bestCandidate: ExtractionCandidate = {
    stcg: 0,
    ltcg: 0,
    foundSummary: false,
    rowsMatched: 0,
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (!rows || rows.length === 0) continue;

    // Record the first few header rows for broker detection
    const topRows = rows
      .slice(0, 6)
      .map((r) => r.map((c) => String(c || '').trim()).join(' '))
      .join('\n');
    headerText += '\n' + topRows;

    let summaryStcg: number | null = null;
    let summaryLtcg: number | null = null;

    let stcgColIdx = -1;
    let ltcgColIdx = -1;
    let termColIdx = -1;
    let pnlColIdx = -1;
    let headerRowIdx = -1;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const isTableHead = isTableHeaderRow(row);

      if (isTableHead && headerRowIdx === -1) {
        headerRowIdx = r;
        for (let c = 0; c < row.length; c++) {
          const cell = String(row[c] || '')
            .trim()
            .toLowerCase();
          if (/^(stcg|short[\s_-]*term[\s_-]*(gain|profit|pnl|capital)?)$/i.test(cell)) {
            stcgColIdx = c;
          } else if (/^(ltcg|long[\s_-]*term[\s_-]*(gain|profit|pnl|capital)?)$/i.test(cell)) {
            ltcgColIdx = c;
          } else if (/^(term|holding[\s_-]*type|category|gain[\s_-]*type)$/i.test(cell)) {
            termColIdx = c;
          } else if (
            /^(realized[\s_-]*p&?l|p&?l|net[\s_-]*profit|gain[\s_-]*loss|profit)$/i.test(cell)
          ) {
            pnlColIdx = c;
          }
        }
        continue;
      }

      // If it's NOT a table header row, check for key-value summary rows
      if (!isTableHead && headerRowIdx === -1) {
        for (let c = 0; c < row.length; c++) {
          const cellStr = String(row[c] || '').trim();
          if (!cellStr) continue;

          const isStcgLabel =
            /(?:short[\s_-]*term|stcg|111a)/i.test(cellStr) &&
            !/(?:long[\s_-]*term|ltcg|112a|unrealized|intraday|speculative|f&o|futures)/i.test(
              cellStr,
            );

          const isLtcgLabel =
            /(?:long[\s_-]*term|ltcg|112a)/i.test(cellStr) &&
            !/(?:short[\s_-]*term|stcg|111a|unrealized|intraday|speculative|f&o|futures)/i.test(
              cellStr,
            );

          if (isStcgLabel) {
            for (let offset = 1; offset <= 6; offset++) {
              if (c + offset < row.length) {
                const val = parseNumeric(row[c + offset]);
                if (val !== null && val >= 0) {
                  summaryStcg = val;
                  break;
                }
              }
            }
            if (summaryStcg === null && r + 1 < rows.length) {
              const nextRowVal = parseNumeric(rows[r + 1][c]);
              if (nextRowVal !== null && nextRowVal >= 0) {
                summaryStcg = nextRowVal;
              }
            }
          }

          if (isLtcgLabel) {
            for (let offset = 1; offset <= 6; offset++) {
              if (c + offset < row.length) {
                const val = parseNumeric(row[c + offset]);
                if (val !== null && val >= 0) {
                  summaryLtcg = val;
                  break;
                }
              }
            }
            if (summaryLtcg === null && r + 1 < rows.length) {
              const nextRowVal = parseNumeric(rows[r + 1][c]);
              if (nextRowVal !== null && nextRowVal >= 0) {
                summaryLtcg = nextRowVal;
              }
            }
          }
        }
      }
    }

    if (summaryStcg !== null || summaryLtcg !== null) {
      const stcg = summaryStcg ?? 0;
      const ltcg = summaryLtcg ?? 0;
      if (!bestCandidate.foundSummary || stcg + ltcg > bestCandidate.stcg + bestCandidate.ltcg) {
        bestCandidate = {
          stcg,
          ltcg,
          foundSummary: true,
          rowsMatched: 1,
        };
      }
    }

    // If summary not found on this sheet, process table rows
    if (!bestCandidate.foundSummary && headerRowIdx !== -1) {
      let colStcg = 0;
      let colLtcg = 0;
      let rowCount = 0;

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        if (stcgColIdx !== -1) {
          const val = parseNumeric(row[stcgColIdx]);
          if (val !== null) {
            colStcg += Math.max(0, val);
            rowCount++;
          }
        }
        if (ltcgColIdx !== -1) {
          const val = parseNumeric(row[ltcgColIdx]);
          if (val !== null) {
            colLtcg += Math.max(0, val);
            rowCount++;
          }
        }
        if (termColIdx !== -1 && pnlColIdx !== -1) {
          const term = String(row[termColIdx] || '').toLowerCase();
          const pnl = parseNumeric(row[pnlColIdx]);
          if (pnl !== null) {
            if (/short|stcg|111a/i.test(term)) {
              colStcg += Math.max(0, pnl);
              rowCount++;
            } else if (/long|ltcg|112a/i.test(term)) {
              colLtcg += Math.max(0, pnl);
              rowCount++;
            }
          }
        }
      }

      if (rowCount > 0 && rowCount >= bestCandidate.rowsMatched) {
        bestCandidate = {
          stcg: Math.round(colStcg * 100) / 100,
          ltcg: Math.round(colLtcg * 100) / 100,
          foundSummary: false,
          rowsMatched: rowCount,
        };
      }
    }
  }

  const brokerName = detectBrokerName(fileName, headerText);

  if (bestCandidate.stcg > 0 || bestCandidate.ltcg > 0 || bestCandidate.foundSummary) {
    return {
      success: true,
      brokerName,
      fileName,
      stcg111A: Math.round(bestCandidate.stcg),
      ltcg112A: Math.round(bestCandidate.ltcg),
      details: bestCandidate.foundSummary
        ? 'Extracted from statement summary'
        : `Aggregated from ${bestCandidate.rowsMatched} trade entries`,
    };
  }

  return {
    success: false,
    brokerName,
    fileName,
    stcg111A: 0,
    ltcg112A: 0,
    error:
      'Could not automatically detect STCG/LTCG columns or summary. You can enter the amounts manually.',
  };
}

export async function parseBrokerFile(file: File): Promise<ParsedBrokerResult> {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    return parseWorkbookData(workbook, file.name);
  } catch (err) {
    return {
      success: false,
      brokerName: detectBrokerName(file.name, ''),
      fileName: file.name,
      stcg111A: 0,
      ltcg112A: 0,
      error: err instanceof Error ? err.message : 'Failed to read file',
    };
  }
}
