// Manually observed in the Income Tax Department UI on 2026-09-13.
// Tax year 2026-27, individual, under 60, resident, opting out = No.
// Its surcharge output is NET of surcharge marginal relief.
export const officialFixtures: {
  income: number;
  slab: number;
  rebate: number;
  surcharge: number;
  cess: number;
  liability: number;
  residency?: 'resident' | 'non-resident';
}[] = [
  { income: 1200000, slab: 60000, rebate: 60000, surcharge: 0, cess: 0, liability: 0 },
  { income: 1250000, slab: 67500, rebate: 17500, surcharge: 0, cess: 2000, liability: 52000 },
  { income: 1425000, slab: 93750, rebate: 0, surcharge: 0, cess: 3750, liability: 97500 },
  { income: 5000010, slab: 1080003, rebate: 0, surcharge: 7, cess: 43200, liability: 1123210 },
  {
    income: 10000010,
    slab: 2580003,
    rebate: 0,
    surcharge: 258007,
    cess: 113520,
    liability: 2951530,
  },
  {
    income: 20000010,
    slab: 5580003,
    rebate: 0,
    surcharge: 837007,
    cess: 256680,
    liability: 6673690,
  },
  {
    income: 1250000,
    slab: 67500,
    rebate: 0,
    surcharge: 0,
    cess: 2700,
    liability: 70200,
    residency: 'non-resident',
  },
];
