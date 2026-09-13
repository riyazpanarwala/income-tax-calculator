import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbookData } from '../src/brokerParser';

describe('brokerParser', () => {
  it('parses Groww format with summary sheet', () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Groww Tax P&L Statement', 'FY 2026-27'],
      ['Client Name: John Doe', 'PAN: ABCDE1234F'],
      [],
      ['Capital Gains Summary', 'Amount (₹)'],
      ['Short-term capital gain (Section 111A)', 35000],
      ['Long-term capital gain (Section 112A)', 140000],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Summary');

    const result = parseWorkbookData(wb, 'Groww_Tax_PnL_2026_27.xlsx');
    expect(result.success).toBe(true);
    expect(result.brokerName).toBe('Groww');
    expect(result.stcg111A).toBe(35000);
    expect(result.ltcg112A).toBe(140000);
  });

  it('parses Shoonya / Finvasia format with table columns', () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Finvasia Securities Pvt Ltd - Shoonya PRISM'],
      ['Scrip Name', 'Buy Date', 'Sell Date', 'STCG', 'LTCG'],
      ['RELIANCE', '2026-05-01', '2026-07-01', 12500, 0],
      ['TCS', '2024-04-01', '2026-06-01', 0, 48000],
      ['INFY', '2026-06-01', '2026-08-01', 7500, 0],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Capital_Gain');

    const result = parseWorkbookData(wb, 'Shoonya_Capital_Gain.xlsx');
    expect(result.success).toBe(true);
    expect(result.brokerName).toBe('Shoonya (Finvasia)');
    expect(result.stcg111A).toBe(20000); // 12500 + 7500
    expect(result.ltcg112A).toBe(48000);
  });

  it('parses Religare format with summary and currency formatting', () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['RELIGARE BROKING LIMITED'],
      ['Capital Gains Report for 2026-2027'],
      [],
      ['Total STCG (Sec 111A)', '₹ 25,450.00'],
      ['Total LTCG (Sec 112A)', '₹ 1,15,200.00'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Summary');

    const result = parseWorkbookData(wb, 'Religare_CapGain_Report.xlsx');
    expect(result.success).toBe(true);
    expect(result.brokerName).toBe('Religare Broking');
    expect(result.stcg111A).toBe(25450);
    expect(result.ltcg112A).toBe(115200);
  });

  it('parses generic broker format with term and P&L columns', () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Symbol', 'Category', 'Realized P&L'],
      ['HDFCBANK', 'Short Term', 18000],
      ['ICICIBANK', 'Long Term', 52000],
      ['SBIN', 'STCG', 4000],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'P&L');

    const result = parseWorkbookData(wb, 'My_Trades.csv');
    expect(result.success).toBe(true);
    expect(result.brokerName).toBe('Other / Custom Broker');
    expect(result.stcg111A).toBe(22000); // 18000 + 4000
    expect(result.ltcg112A).toBe(52000);
  });

  it('aggregates multiple brokers (Religare + Shoonya + Groww) correctly into tax engine', async () => {
    const { emptyInput } = await import('../src/tax-engine/types');
    const { calculateFinalTax } = await import('../src/tax-engine/calculateFinalTax');

    // Simulated broker entries
    const brokerEntries = [
      { broker: 'Religare Broking', stcg111A: 20000, ltcg112A: 80000 },
      { broker: 'Shoonya (Finvasia)', stcg111A: 10000, ltcg112A: 70000 },
      { broker: 'Groww', stcg111A: 15000, ltcg112A: 50000 },
    ];

    const totalStcg = brokerEntries.reduce((acc, b) => acc + b.stcg111A, 0); // 45,000
    const totalLtcg = brokerEntries.reduce((acc, b) => acc + b.ltcg112A, 0); // 200,000

    const input = emptyInput();
    input.salary.basic = 1500000;
    input.gains = [
      {
        kind: '111A',
        asset: 'equity',
        amount: totalStcg,
        acquired: '2026-04-01',
        sold: '2026-09-15',
        confirmed: true,
      },
      {
        kind: '112A',
        asset: 'equity',
        amount: totalLtcg,
        acquired: '2024-04-01',
        sold: '2026-05-15',
        confirmed: true,
      },
    ];

    const calculation = calculateFinalTax(input);
    expect(calculation.ok).toBe(true);
    if (!calculation.ok) return;

    // Special rate gains verification
    const specialRows = calculation.result.special.rows;
    const row111A = specialRows.find((r) => r.kind === '111A');
    const row112A = specialRows.find((r) => r.kind === '112A');

    expect(row111A?.amount).toBe(45000);
    expect(row111A?.tax).toBe(45000 * 0.2); // 9,000

    expect(row112A?.amount).toBe(200000);
    expect(row112A?.exemption).toBe(125000); // statutory ₹1.25L exemption applied once
    expect(row112A?.taxable).toBe(75000); // 200,000 - 125,000
    expect(row112A?.tax).toBe(75000 * 0.125); // 9,375
  });
});
