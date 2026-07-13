import { describe, expect, it } from 'vitest';
import { parseImportFile } from '@/lib/mis-client-import/detect-parse';
import {
  isWrlmisBuffer,
  isWrlmisFileName,
  packCsvBufferToWrlmis,
  packWrlmisPayload,
  unpackWrlmisBuffer,
  WRLMIS_MAGIC,
} from '@/lib/mis-client-import/wrlmis-pack';
import type { MisClientSourceConfig } from '@/lib/mis-client-import/types';

const cadburyConfig = {
  id: 'cadbury',
  code: 'cadbury',
  name: 'Cadbury',
  file_kind: 'csv',
  delimiter: '|',
  header_row_index: 1,
  call_key_column: '.TicketNumber',
  crm_account_filter: null,
  is_active: true,
  field_mappings: [],
} as unknown as MisClientSourceConfig;

describe('wrlmis pack', () => {
  it('detects magic and extension', () => {
    expect(isWrlmisFileName('mondelez.wrlmis')).toBe(true);
    expect(isWrlmisFileName('mondelez.WRLMIS')).toBe(true);
    expect(isWrlmisFileName('mondelez.csv')).toBe(false);
    expect(isWrlmisBuffer(Buffer.concat([WRLMIS_MAGIC, Buffer.from([1, 2, 3])]))).toBe(true);
    expect(isWrlmisBuffer(Buffer.from('not-a-pack'))).toBe(false);
  });

  it('round-trips packed payload to records', () => {
    const headers = ['.TicketNumber', 'VDate', 'Call Status', 'Branch Name'];
    const packed = packWrlmisPayload({
      sourceHint: 'cadbury',
      fileName: 'sample.csv',
      packedAt: '2026-07-13T00:00:00.000Z',
      headers,
      rows: [
        ['T1', '2026-01-01', 'Open', 'Delhi'],
        ['T2', '2026-01-02', 'Closed', 'Mumbai'],
      ],
    });

    expect(isWrlmisBuffer(packed)).toBe(true);
    const unpacked = unpackWrlmisBuffer(packed);
    expect(unpacked.sourceHint).toBe('cadbury');
    expect(unpacked.fileName).toBe('sample.csv');
    expect(unpacked.headers).toEqual(headers);
    expect(unpacked.rows).toEqual([
      {
        '.TicketNumber': 'T1',
        VDate: '2026-01-01',
        'Call Status': 'Open',
        'Branch Name': 'Delhi',
      },
      {
        '.TicketNumber': 'T2',
        VDate: '2026-01-02',
        'Call Status': 'Closed',
        'Branch Name': 'Mumbai',
      },
    ]);
  });

  it('packs pipe CSV buffer into wrlmis and parseImportFile unpacks it', async () => {
    const csv = Buffer.from(
      '.TicketNumber|VDate|Call Status|Branch Name\n' +
        'T1|2026-01-01|Open|Delhi\n' +
        'T2|2026-01-02|Closed|Mumbai\n',
      'utf8'
    );
    const { packed, rowCount, sourceHint } = packCsvBufferToWrlmis(csv, 'VMS.csv');
    expect(rowCount).toBe(2);
    expect(sourceHint).toBe('cadbury');
    expect(isWrlmisBuffer(packed)).toBe(true);

    const result = await parseImportFile(packed, 'VMS.wrlmis', cadburyConfig);
    expect(result.detectedFormat).toBe('wrlmis');
    expect(result.sniffedSource).toBe('cadbury');
    expect(result.rawRows).toHaveLength(2);
    expect(result.rawRows[0]['.TicketNumber']).toBe('T1');
    expect(result.warnings.some((w) => w.includes('WRLMIS1'))).toBe(true);
  });
});
