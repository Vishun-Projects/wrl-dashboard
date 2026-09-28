import { describe, expect, it } from 'vitest';
import { assignResolvedCalls, extractCallNumbers } from '@/modules/spare-stock-analysis/server/call-no';
import { groupByRowKey } from '@/modules/spare-stock-analysis/server/import-classify';
import { parseMb51Html } from '@/modules/spare-stock-analysis/server/parse-mb51-html';
import { computeStockKpis } from '@/modules/spare-stock-analysis/server/stock';
import {
  normalizeCallNo,
  parseSapQty,
  txnTypeForMvt,
} from '@/modules/spare-stock-analysis/server/txn-type';

const SAMPLE = `<html><body><table class="list">
<tr>
<td>Plnt</td><td>Mat. Doc.</td><td>Doc. Date</td><td>Pstng Date</td>
<td>Material</td><td>Material Description</td><td>Location</td><td>EUn</td>
<td>Qty in UnE</td><td>LC Amount</td><td>MvT</td><td>Movement Type Text</td>
<td>Batch</td><td>Entry Date</td><td>Time</td><td>User</td>
<td>Material Group</td><td>Customer</td><td>Document Header Text</td><td>Text</td>
<td>MatYr</td><td>Order</td><td>Supplier</td>
</tr>
<tr>
<td>1158</td><td>4900048120</td><td>31.01.2025</td><td>31.01.2025</td>
<td>1500170</td><td>COMPRESSOR KCE419HAG - B130 50HZ</td><td>S200</td><td>NOS</td>
<td>    1.000 </td><td>   1,787.86 </td><td>561</td><td>Init.entry of stBal.</td>
<td></td><td>02.02.2025</td><td>05:24:29</td><td>MIG04</td>
<td>COMPRESOR</td><td></td><td>Legacy Data Migration</td><td></td>
<td>2025</td><td></td><td></td>
</tr>
<tr>
<td>1158</td><td>4900048121</td><td>31.01.2025</td><td>31.01.2025</td>
<td>1500194</td><td>COMPRESSOR 105F3800 NL 8.4CLX 220V/R404A</td><td>S200</td><td>NOS</td>
<td>    2.000 </td><td>   8,113.98 </td><td>561</td><td>Init.entry of stBal.</td>
<td></td><td>02.02.2025</td><td>05:24:30</td><td>MIG04</td>
<td>COMPRESOR</td><td></td><td>Legacy Data Migration</td><td></td>
<td>2025</td><td></td><td></td>
</tr>
<tr>
<td>1158</td><td>4900048122</td><td>31.01.2025</td><td>31.01.2025</td>
<td>1500195</td><td>COMPRESSOR 105G6040 NL8.4FT 220V/R134a</td><td>S200</td><td>NOS</td>
<td>    6.000 </td><td>  21,556.30 </td><td>561</td><td>Init.entry of stBal.</td>
<td></td><td>02.02.2025</td><td>05:24:30</td><td>MIG04</td>
<td>COMPRESOR</td><td></td><td>Legacy Data Migration</td><td></td>
<td>2025</td><td></td><td></td>
</tr>
</table></body></html>`;

describe('MB51 spare stock parse + stock math', () => {
  it('parses sample opening rows, maps 561, and closing equals opening 9', () => {
    const { rows, skipped } = parseMb51Html(SAMPLE);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.qty)).toEqual([1, 2, 6]);
    expect(rows.every((r) => r.txnType === 'opening')).toBe(true);
    expect(rows[0]).toMatchObject({
      plant: '1158',
      material: '1500170',
      postingDate: '2025-01-31',
      mvt: '561',
    });
    expect(parseSapQty('    1.000 ')).toBe(1);
    expect(parseSapQty('1.000-')).toBe(-1);
    expect(parseSapQty('2.000-')).toBe(-2);
    expect(txnTypeForMvt('561')).toBe('opening');

    const kpis = computeStockKpis(
      rows.map((r) => ({ txnType: r.txnType, postingDate: r.postingDate, qty: r.qty })),
      '2025-01-01',
      '2025-12-31'
    );
    expect(kpis).toEqual({
      opening: 9,
      received: 0,
      issued: 0,
      consumption: 0,
      closing: 9,
    });

    expect(normalizeCallNo('25B01368-Dharsan Agency')).toBe('25B01368');
    expect(normalizeCallNo('24L272072')).toBe('24L272072');
    expect(normalizeCallNo('25G28576/TAMIL ICE COMPAN')).toBe('25G28576');
    expect(normalizeCallNo('INV NO.1302602482 12.08.2026')).toBe('');
    expect(extractCallNumbers('INV NO.1302602482 12.08.2026')).toEqual([]);
    expect(extractCallNumbers('inv no.1302602482 12.08.2026')).toEqual([]);
    expect(extractCallNumbers('25G28576/TAMIL ICE COMPAN')).toEqual(['25G28576']);
    expect(extractCallNumbers('25G281371/25G291216/25G31722/25G31836/25H01689')).toEqual([
      '25G281371',
      '25G291216',
      '25G31722',
      '25G31836',
      '25H01689',
    ]);

    const multiText = '25G281371/25G291216/25G31722/25G31836/25H01689';
    const multiRows = [
      { plant: '1158', matDoc: '4900978434', callNo: multiText },
      { plant: '1158', matDoc: '4900978434', callNo: multiText },
      { plant: '1158', matDoc: '4900978434', callNo: multiText },
      { plant: '1158', matDoc: '4900978434', callNo: multiText },
    ];
    const registered = new Set(['25G281371', '25G291216', '25G31722', '25G31836']);
    expect(assignResolvedCalls(multiRows, registered)).toEqual([
      '25G281371',
      '25G291216',
      '25G31722',
      '25G31836',
    ]);
    expect(assignResolvedCalls(multiRows, new Set(extractCallNumbers(multiText)))).toEqual([
      '25G281371',
      '25G291216',
      '25G31722',
      '25G31836',
    ]);
    expect(Math.abs(1) - Math.abs(1)).toBe(0);
    expect(Math.abs(1) - Math.abs(0)).toBe(1);

    const twin = { ...rows[0], matDoc: rows[0].matDoc, rowKey: rows[0].rowKey };
    const grouped = groupByRowKey([rows[0], twin, rows[1]]);
    expect(grouped.get(rows[0].rowKey)?.length).toBe(2);
    expect([...grouped.values()].filter((g) => g.length > 1)).toHaveLength(1);
  });
});
