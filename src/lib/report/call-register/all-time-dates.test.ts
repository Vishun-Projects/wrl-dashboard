import { isCallRegisterAllTime, resolveCallRegisterDates } from './dates';

{
  const allTime = resolveCallRegisterDates(new URLSearchParams(''));
  console.assert(isCallRegisterAllTime(allTime), 'empty query must be All Time');

  const month = resolveCallRegisterDates(
    new URLSearchParams('dateFrom=2026-07-01&dateTo=2026-07-20')
  );
  console.assert(!isCallRegisterAllTime(month), 'dated query must not be All Time');
  console.assert(month.dateFrom === '2026-07-01' && month.dateTo === '2026-07-20');

  console.log('ok: call-register All Time date resolution');
}
