import { describe, expect, it } from 'vitest';
import { parseZss02Html } from '@/modules/spare-loan-check/server/parse-zss02-html';
import { selectMatchKey } from '@/modules/spare-loan-check/server/match';

const SAMPLE = `<html><body><table class="list">
<tr>
<td>Plant</td><td>Vendor No.</td><td>Vendor Name</td><td>Material</td>
<td>Material Description</td><td>Barcode of Spare Part</td>
<td>SO.No.(Con/Rtn)</td><td>SO.No.(Loan)</td>
<td>Loan_Date</td><td>Loan Rtn Date</td><td>Cnsmp.Date</td><td>No Cnsmp.Count</td>
<td>Sale Date</td><td>Sale Rtn Date</td>
</tr>
<tr><td>*</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr>
<td>1152</td><td>300364</td><td>MOHAN C</td><td>1500978</td><td>COMPRESSOR</td><td>ABC</td>
<td>25B22681</td><td>25B22681</td>
<td>25.02.2025</td><td>00.00.0000</td><td></td><td></td><td></td><td></td>
</tr>
<tr>
<td>1152</td><td>300364</td><td>MOHAN C</td><td>1500978</td><td>COMPRESSOR</td><td>DEF</td>
<td>25B18215</td><td>Buffer</td>
<td>20.02.2025</td><td>00.00.0000</td><td></td><td></td><td></td><td></td>
</tr>
<tr>
<td>1152</td><td>300364</td><td>MOHAN C</td><td>1500978</td><td>COMPRESSOR</td><td>GHI</td>
<td></td><td>Buffer</td>
<td>20.02.2025</td><td>00.00.0000</td><td></td><td></td><td></td><td></td>
</tr>
</table></body></html>`;

describe('parseZss02Html', () => {
  it('parses plant data rows and skips star totals', () => {
    const rows = parseZss02Html(SAMPLE);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      plant: '1152',
      vendorNo: '300364',
      soLoan: '25B22681',
      soConRtn: '25B22681',
    });
    expect(selectMatchKey(rows[1].soLoan, rows[1].soConRtn)).toEqual({
      key: '25B18215',
      source: 'con_rtn',
    });
    expect(selectMatchKey(rows[2].soLoan, rows[2].soConRtn)).toBeNull();
  });
});
