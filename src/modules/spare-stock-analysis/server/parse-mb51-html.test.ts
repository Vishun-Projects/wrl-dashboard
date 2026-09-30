import { describe, expect, it } from 'vitest';
import { assignResolvedCalls, extractCallNumbers } from '@/modules/spare-stock-analysis/server/call-no';
import { groupByRowKey } from '@/modules/spare-stock-analysis/server/import-classify';
import { parseMb51FileInBatches, mapHeaders, decodeMb51Entities } from '@/modules/spare-stock-analysis/parse-mb51';
import {
  formatSpareStockPlantLabel,
  formatSpareStockSupplierLabel,
} from '@/modules/spare-stock-analysis/plants';
import { parseMb51Html } from '@/modules/spare-stock-analysis/server/parse-mb51-html';
import { cleanDebitCreditPairs, computeStockKpis } from '@/modules/spare-stock-analysis/server/stock';
import {
  applyUneToKg,
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
  it('parses sample opening rows, maps 561, and closing equals opening 9', async () => {
    const { rows, skipped } = await parseMb51Html(SAMPLE);
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

    expect(rows[0].rowKey).toMatch(/^[0-9a-f]{64}$/);
    const streamed: typeof rows = [];
    const result = await parseMb51FileInBatches(new Blob([SAMPLE], { type: 'text/html' }), async (batch) => {
      streamed.push(...batch);
    });
    expect(result).toEqual({ parsed: 3, skipped: 0 });
    expect(streamed.map((r) => r.rowKey)).toEqual(rows.map((r) => r.rowKey));
    expect(streamed.map((r) => r.qty)).toEqual([1, 2, 6]);
  });

  it('maps the MB51_1.htm header line including Quantity in UnE', () => {
    const cells = `Plnt	Mat. Doc. 	Doc. Date 	Pstng Date	Material          	Material Description                    	Location	EUn	Quantity in UnE	     LC Amount	MvT	Movement Type Text  	Batch     	Entry Date	Time    	User Name	Material Group	Customer	Document Header Text     	Text                                              	MatYr	Order	Supplier`
      .split('\t')
      .map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase());
    const colMap = mapHeaders(cells);
    expect(colMap).not.toBeNull();
    expect(colMap).toMatchObject({
      plant: 0,
      material: 4,
      qty: 8,
      mvt: 10,
      sapUser: 15,
    });
  });

  it('accepts SAP ALV Quantity in UnE / User Name headers', async () => {
    const html = SAMPLE.replace('Qty in UnE', 'Quantity in UnE').replace('>User<', '>User Name<');
    const streamed: Array<{ qty: number; sapUser: string }> = [];
    const result = await parseMb51FileInBatches(new Blob([html], { type: 'text/html' }), async (batch) => {
      streamed.push(...batch);
    });
    expect(result).toEqual({ parsed: 3, skipped: 0 });
    expect(streamed.map((r) => r.qty)).toEqual([1, 2, 6]);
    expect(streamed[0]?.sapUser).toBe('MIG04');
  });

  it('decodes SAP hex entities and skips excluded plants', async () => {
    expect(decodeMb51Entities('MOTOR &#x28;D&#x29;')).toBe('MOTOR (D)');
    expect(decodeMb51Entities('100&#x2f;300&#x2f;400')).toBe('100/300/400');
    expect(decodeMb51Entities('05&#x3a;24&#x3a;29')).toBe('05:24:29');
    expect(decodeMb51Entities('A &amp; B')).toBe('A & B');

    const html = SAMPLE.replace(
      '</table>',
      `<tr>
<td>1130</td><td>4900099999</td><td>31.01.2025</td><td>31.01.2025</td>
<td>1500001</td><td>MOTOR &#x28;D&#x29;</td><td>S200</td><td>NOS</td>
<td>    1.000 </td><td>   1.00 </td><td>561</td><td>Init.entry of stBal.</td>
<td></td><td>02.02.2025</td><td>05&#x3a;24&#x3a;29</td><td>MIG04</td>
<td>COMPRESOR</td><td></td><td>Legacy</td><td></td>
<td>2025</td><td></td><td></td>
</tr>
<tr>
<td>1158</td><td>4900099998</td><td>31.01.2025</td><td>31.01.2025</td>
<td>1500002</td><td>MOTOR &#x28;D&#x29;</td><td>S200</td><td>NOS</td>
<td>    1.000 </td><td>   1.00 </td><td>561</td><td>Init.entry of stBal.</td>
<td></td><td>02.02.2025</td><td>05&#x3a;24&#x3a;29</td><td>MIG04</td>
<td>COMPRESOR</td><td></td><td>Legacy</td><td></td>
<td>2025</td><td></td><td></td>
</tr></table>`
    );
    const streamed: Array<{ plant: string; materialDescription: string; entryTime: string }> = [];
    const result = await parseMb51FileInBatches(new Blob([html], { type: 'text/html' }), async (batch) => {
      streamed.push(...batch);
    });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const motor = streamed.find((r) => r.materialDescription.includes('MOTOR'));
    expect(motor?.plant).toBe('1158');
    expect(motor?.materialDescription).toBe('MOTOR (D)');
    expect(motor?.entryTime).toBe('05:24:29');
    expect(streamed.some((r) => r.plant === '1130')).toBe(false);
  });

  it('formats plant/supplier labels without doubling the code', () => {
    expect(formatSpareStockPlantLabel('1182', '1182 - PATNA BRANCH')).toBe('1182 — PATNA BRANCH');
    expect(formatSpareStockPlantLabel('1182', 'PATNA BRANCH')).toBe('1182 — PATNA BRANCH');
    expect(formatSpareStockPlantLabel('1182', null)).toBe('1182');
    expect(formatSpareStockSupplierLabel('307438', 'ACME COOLING')).toBe('307438 — ACME COOLING');
    expect(formatSpareStockSupplierLabel('307438', null)).toBe('307438');
  });

  it('converts G/GM/GMS/GRM to KG ×1000 and leaves KG alone', () => {
    expect(applyUneToKg('G', 1800)).toEqual({ uom: 'KG', qty: 1.8 });
    expect(applyUneToKg('gm', 500)).toEqual({ uom: 'KG', qty: 0.5 });
    expect(applyUneToKg('GMS', 2000)).toEqual({ uom: 'KG', qty: 2 });
    expect(applyUneToKg('GRM', 1000)).toEqual({ uom: 'KG', qty: 1 });
    expect(applyUneToKg('KG', 2)).toEqual({ uom: 'KG', qty: 2 });
    expect(applyUneToKg('NOS', 3)).toEqual({ uom: 'NOS', qty: 3 });
  });

  it('keeps blank storage location when debit and credit share abs qty', () => {
    const cleaned = cleanDebitCreditPairs([
      {
        plant: '1182',
        matDoc: '4900978057',
        material: '1520590',
        mvt: '941',
        qty: 2,
        location: '',
      },
      {
        plant: '1182',
        matDoc: '4900978057',
        material: '1520590',
        mvt: '941',
        qty: -2,
        location: 'S200',
      },
      {
        plant: '1182',
        matDoc: '4900978057',
        material: '1521393',
        mvt: '941',
        qty: -3,
        location: 'S200',
      },
      {
        plant: '1182',
        matDoc: '4900978057',
        material: '1521393',
        mvt: '941',
        qty: 3,
        location: '',
      },
    ]);
    expect(cleaned).toEqual([
      {
        plant: '1182',
        matDoc: '4900978057',
        material: '1520590',
        mvt: '941',
        qty: 2,
        location: '',
      },
      {
        plant: '1182',
        matDoc: '4900978057',
        material: '1521393',
        mvt: '941',
        qty: 3,
        location: '',
      },
    ]);
  });

  it('rolls opening from 561 + prior mapped net, with signed receipt/consumption', () => {
    expect(txnTypeForMvt('802')).toBe('issued');
    expect(txnTypeForMvt('945')).toBe('receipt');
    expect(txnTypeForMvt('854')).toBe('receipt');

    const rows = [
      { txnType: 'opening' as const, postingDate: '2025-01-31', qty: 10 },
      { txnType: 'issued' as const, postingDate: '2025-02-10', qty: 4 },
      { txnType: 'receipt' as const, postingDate: '2025-02-15', qty: 2 },
      { txnType: 'consumption' as const, postingDate: '2025-02-20', qty: 1 },
      { txnType: 'issued' as const, postingDate: '2025-03-05', qty: 3 },
      { txnType: 'receipt' as const, postingDate: '2025-03-06', qty: 1 },
      { txnType: 'consumption' as const, postingDate: '2025-03-07', qty: 2 },
    ];

    const mar = computeStockKpis(rows, '2025-03-01', '2025-03-10');
    // Opening = 10 + 4 - 2 - 1 = 11
    expect(mar).toEqual({
      opening: 11,
      issued: 3,
      received: -1,
      consumption: -2,
      closing: 11,
    });

    const beforeLegacy = computeStockKpis(rows, '2025-01-01', '2025-01-31');
    expect(beforeLegacy).toEqual({
      opening: 10,
      issued: 0,
      received: 0,
      consumption: 0,
      closing: 10,
    });
  });

  it('parses gram UnE rows into KG qty', async () => {
    const html = `<html><body><table class="list">
<tr>
<td>Plnt</td><td>Mat. Doc.</td><td>Doc. Date</td><td>Pstng Date</td>
<td>Material</td><td>Material Description</td><td>Location</td><td>EUn</td>
<td>Qty in UnE</td><td>LC Amount</td><td>MvT</td><td>Movement Type Text</td>
<td>Batch</td><td>Entry Date</td><td>Time</td><td>User</td>
<td>Material Group</td><td>Customer</td><td>Document Header Text</td><td>Text</td>
<td>MatYr</td><td>Order</td><td>Supplier</td>
</tr>
<tr>
<td>1182</td><td>4900000001</td><td>05.08.2025</td><td>05.08.2025</td>
<td>1520590</td><td>BONDTITE</td><td></td><td>G</td>
<td>    1,800.000 </td><td>0</td><td>941</td><td>Issue</td>
<td></td><td>05.08.2025</td><td>10:00:00</td><td>MIG04</td>
<td></td><td></td><td></td><td></td>
<td>2025</td><td></td><td></td>
</tr>
<tr>
<td>1182</td><td>4900000002</td><td>05.08.2025</td><td>05.08.2025</td>
<td>1520591</td><td>SEAL</td><td>S200</td><td>KG</td>
<td>    2.000 </td><td>0</td><td>941</td><td>Issue</td>
<td></td><td>05.08.2025</td><td>10:00:00</td><td>MIG04</td>
<td></td><td></td><td></td><td></td>
<td>2025</td><td></td><td></td>
</tr>
</table></body></html>`;
    const { rows } = await parseMb51Html(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ uom: 'KG', qty: 1.8, txnType: 'issued' });
    expect(rows[1]).toMatchObject({ uom: 'KG', qty: 2, txnType: 'issued' });
  });
});
