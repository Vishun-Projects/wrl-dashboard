import { parseCrmDaddedon, monthChunks, yearChunks, periodDays } from './shared';

{
  const d = parseCrmDaddedon('11/06/2026 01:22:09');
  console.assert(d != null && d.toISOString().startsWith('2026-06-11'), 'parse daddedon');

  const months = monthChunks('2026-01-15', '2026-03-10');
  console.assert(months.length === 3, 'month chunks');
  console.assert(months[0].from === '2026-01-15' && months[2].to === '2026-03-10');

  const years = yearChunks('2024-06-01', '2026-03-10');
  console.assert(years.length === 3 && years[0].from === '2024-06-01' && years[2].to === '2026-03-10');

  console.assert(periodDays('2024-01-01', '2024-01-07') === 7, 'period days');

  console.log('ok: transaction-entry shared helpers');
}
