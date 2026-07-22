import { fetchWithRetry } from '@/lib/net/fetch-with-retry';

/**
 * Download a MIS batch file with retries. On mid-transfer failure, resumes
 * via Range when the server returns Accept-Ranges (stored files only).
 */
export async function downloadMisBatchFile(params: {
  batchId: string;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; fileName: string | null; contentType: string }> {
  const url = `/api/mis-client-import/batches/${params.batchId}/download`;
  const parts: Uint8Array[] = [];
  let offset = 0;
  let fileName: string | null = null;
  let contentType = 'application/octet-stream';
  let total: number | null = null;
  let acceptRanges = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    const headers: Record<string, string> = {};
    if (offset > 0 && acceptRanges) {
      headers.Range = `bytes=${offset}-`;
    }

    let res: Response;
    try {
      res = await fetchWithRetry(url, {
        credentials: 'include',
        signal: params.signal,
        headers,
        retries: offset > 0 ? 2 : 3,
      });
    } catch (err) {
      if (offset > 0 && acceptRanges && attempt < 3) continue;
      throw err;
    }

    if (res.status === 416) {
      break;
    }

    if (!res.ok && res.status !== 206) {
      throw await errorFromResponse(res);
    }

    fileName = fileNameFromDisposition(res.headers.get('content-disposition')) ?? fileName;
    contentType = res.headers.get('content-type') ?? contentType;
    acceptRanges =
      acceptRanges || (res.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes');

    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const m = /\/(\d+)\s*$/.exec(contentRange);
      if (m) total = Number(m[1]);
    } else {
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && offset === 0) total = len;
    }

    if (contentType.includes('application/json')) {
      throw await errorFromResponse(res);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer());
      parts.push(buf);
      offset += buf.byteLength;
      break;
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        parts.push(value);
        offset += value.length;
      }
      break;
    } catch (err) {
      if (!acceptRanges || attempt >= 3) throw err;
      // keep offset / parts and retry with Range
    }
  }

  if (total != null && offset < total && acceptRanges) {
    throw new Error(`Download incomplete (${offset} of ${total} bytes)`);
  }

  return {
    blob: new Blob(parts as BlobPart[], { type: contentType }),
    fileName,
    contentType,
  };
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
  return m?.[1]?.trim() || null;
}

async function errorFromResponse(res: Response): Promise<Error> {
  try {
    const data = (await res.json()) as { error?: string };
    return new Error(data.error || `Download failed (${res.status})`);
  } catch {
    return new Error(`Download failed (${res.status})`);
  }
}
