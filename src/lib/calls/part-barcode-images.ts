export type CallDocument = {
  filename?: string | null;
  original_name?: string | null;
  remarks?: string | null;
  office_id?: string | number | null;
  uploaded_at?: string | null;
};

export type CallPart = {
  vpartname?: string | null;
  vpartcode?: string | null;
  voldbarcode?: string | null;
  vnewbarcode?: string | null;
  vremarks?: string | null;
  nqty?: number | string | null;
};

export type CallImage = {
  url: string;
  filename: string;
  original_name: string;
  title: string;
  office_id: string;
  uploaded_at?: string;
};

export type BarcodeImageMatch = {
  barcode: string;
  label: 'old' | 'new';
  images: CallImage[];
};

export type ReplacementPartView = {
  part: CallPart;
  partKind: 'compressor' | 'motor' | 'other';
  oldBarcode: BarcodeImageMatch | null;
  newBarcode: BarcodeImageMatch | null;
  /** Images not matched to a specific barcode (e.g. part photo). */
  otherImages: CallImage[];
};

const UPLOAD_BASE = 'https://westerncrm.com/WRL/UploadDocs';

export function buildCallImageUrl(officeId: string | number, filename: string): string {
  return `${UPLOAD_BASE}/${officeId}/${filename.trim()}`;
}

export function buildCallImages(documents: CallDocument[] = []): CallImage[] {
  return documents
    .filter((d) => d.filename && String(d.filename).trim())
    .map((d) => ({
      url: buildCallImageUrl(d.office_id ?? '', String(d.filename)),
      filename: String(d.filename).trim(),
      original_name: String(d.original_name ?? '').trim(),
      title: String(d.remarks || d.original_name || d.filename).trim(),
      office_id: String(d.office_id ?? ''),
      uploaded_at: d.uploaded_at ?? undefined,
    }));
}

function normalizeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function partNameKind(name: string): 'compressor' | 'motor' | 'other' {
  const lower = name.toLowerCase();
  if (lower.includes('compressor')) return 'compressor';
  if (lower.includes('motor')) return 'motor';
  return 'other';
}

/** Compressor / motor parts with old or new barcode captured. */
export function isSerialTrackedReplacementPart(part: CallPart): boolean {
  const hasBarcode =
    Boolean(String(part.voldbarcode ?? '').trim()) ||
    Boolean(String(part.vnewbarcode ?? '').trim());
  if (!hasBarcode) return false;

  const kind = partNameKind(String(part.vpartname ?? ''));
  return kind === 'compressor' || kind === 'motor';
}

function imageHaystack(img: CallImage): string {
  return normalizeToken(`${img.title} ${img.filename} ${img.original_name}`);
}

function barcodeMatchesImage(barcode: string, img: CallImage): boolean {
  const normBarcode = normalizeToken(barcode);
  if (normBarcode.length < 6) return false;

  const haystack = imageHaystack(img);
  if (haystack.includes(normBarcode)) return true;

  // Partial match for long serials (EXIF overlay may truncate).
  if (normBarcode.length >= 12) {
    const tail = normBarcode.slice(-10);
    if (tail.length >= 8 && haystack.includes(tail)) return true;
  }

  return false;
}

function matchImagesForBarcode(
  barcode: string,
  label: 'old' | 'new',
  images: CallImage[]
): BarcodeImageMatch | null {
  const trimmed = String(barcode ?? '').trim();
  if (!trimmed) return null;

  const matched = images.filter((img) => barcodeMatchesImage(trimmed, img));
  return { barcode: trimmed, label, images: matched };
}

function assignImagesToSinglePart(
  part: CallPart,
  images: CallImage[]
): ReplacementPartView {
  const partKind = partNameKind(String(part.vpartname ?? ''));
  const oldBarcode = matchImagesForBarcode(String(part.voldbarcode ?? ''), 'old', images);
  const newBarcode = matchImagesForBarcode(String(part.vnewbarcode ?? ''), 'new', images);

  const claimed = new Set<string>();
  for (const match of [oldBarcode, newBarcode]) {
    for (const img of match?.images ?? []) claimed.add(img.url);
  }

  const otherImages = images.filter((img) => !claimed.has(img.url));

  return {
    part,
    partKind,
    oldBarcode,
    newBarcode,
    otherImages,
  };
}

/**
 * Maps call documents to compressor/motor replacement parts and their barcode images.
 * When only one serial-tracked part exists, unattributed images are grouped with it.
 */
export function buildReplacementPartViews(
  parts: CallPart[] = [],
  documents: CallDocument[] = []
): ReplacementPartView[] {
  const replacementParts = parts.filter(isSerialTrackedReplacementPart);
  if (replacementParts.length === 0) return [];

  const images = buildCallImages(documents);

  if (replacementParts.length === 1) {
    return [assignImagesToSinglePart(replacementParts[0], images)];
  }

  const views = replacementParts.map((part) => assignImagesToSinglePart(part, images));

  // Drop images already matched to a barcode on any part; share leftovers only when unambiguous.
  const matchedUrls = new Set<string>();
  for (const view of views) {
    for (const match of [view.oldBarcode, view.newBarcode]) {
      for (const img of match?.images ?? []) matchedUrls.add(img.url);
    }
  }

  const unmatched = images.filter((img) => !matchedUrls.has(img.url));
  if (unmatched.length > 0 && views.length === 1) {
    views[0].otherImages.push(...unmatched);
  }

  return views;
}

export function countReplacementPartImages(view: ReplacementPartView): number {
  const urls = new Set<string>();
  for (const match of [view.oldBarcode, view.newBarcode]) {
    for (const img of match?.images ?? []) urls.add(img.url);
  }
  for (const img of view.otherImages) urls.add(img.url);
  return urls.size;
}
