import type sharp from 'sharp';
import { Jimp } from 'jimp';

const MAX_EDGE = 1600;
/** Field photos often burn call id / timestamp / GPS into the top strip. */
const OVERLAY_TOP_RATIO = 0.14;

type SharpConstructor = typeof sharp;
type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

let sharpFn: SharpConstructor | null | undefined;
let sharpUnavailable = false;

/** Try sharp once; cache success/failure for the process lifetime. */
export async function loadSharp(): Promise<SharpConstructor | null> {
  if (sharpUnavailable) return null;
  if (sharpFn) return sharpFn;
  if (sharpFn === null) return null;
  try {
    const mod = await import('sharp');
    const fn = mod.default;
    await fn({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    sharpFn = fn;
    return sharpFn;
  } catch {
    sharpUnavailable = true;
    sharpFn = null;
    return null;
  }
}

export function luminanceFromBitmap(bitmap: {
  width: number;
  height: number;
  data: Buffer | Uint8Array;
}): { lum: Uint8ClampedArray; width: number; height: number } {
  const { width, height, data } = bitmap;
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    lum[i] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }
  return { lum, width, height };
}

async function luminanceFromBufferSharp(
  buffer: Buffer,
  fn: SharpConstructor
): Promise<{ lum: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    const { data, info } = await fn(buffer)
      .greyscale()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    if (!width || !height) return null;
    const lum = new Uint8ClampedArray(width * height);
    for (let i = 0; i < width * height; i += 1) {
      lum[i] = data[i * 4];
    }
    return { lum, width, height };
  } catch {
    return null;
  }
}

async function luminanceFromBufferJimp(buffer: Buffer): Promise<{
  lum: Uint8ClampedArray;
  width: number;
  height: number;
} | null> {
  try {
    const img = await Jimp.read(buffer);
    img.greyscale();
    return luminanceFromBitmap(img.bitmap);
  } catch {
    return null;
  }
}

export async function luminanceFromBuffer(buffer: Buffer): Promise<{
  lum: Uint8ClampedArray;
  width: number;
  height: number;
} | null> {
  const fn = await loadSharp();
  if (fn) {
    const out = await luminanceFromBufferSharp(buffer, fn);
    if (out) return out;
  }
  return luminanceFromBufferJimp(buffer);
}

async function buildScanVariantsSharp(buffer: Buffer, fn: SharpConstructor): Promise<Buffer[]> {
  const variants: Buffer[] = [];
  try {
    const oriented = await fn(buffer).rotate().toBuffer();
    const meta = await fn(oriented).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return [];

    const topCrop = Math.min(Math.round(height * OVERLAY_TOP_RATIO), Math.floor(height / 4));
    let cropped = oriented;
    if (topCrop > 0 && height - topCrop >= 80) {
      cropped = await fn(oriented)
        .extract({ left: 0, top: topCrop, width, height: height - topCrop })
        .toBuffer();
    }

    async function finish(buf: Buffer, rotateDeg = 0): Promise<Buffer | null> {
      try {
        return await fn(buf)
          .rotate(rotateDeg)
          .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: false })
          .greyscale()
          .normalize()
          .sharpen()
          .jpeg({ quality: 88 })
          .toBuffer();
      } catch {
        return null;
      }
    }

    for (const deg of [0, 90, 270]) {
      const out = await finish(cropped, deg);
      if (out) variants.push(out);
    }

    try {
      const hc = await fn(cropped)
        .rotate(90)
        .greyscale()
        .normalize()
        .linear(1.4, -20)
        .threshold(150)
        .jpeg({ quality: 88 })
        .toBuffer();
      if (hc) variants.push(hc);
    } catch {
      /* skip */
    }
  } catch {
    return [];
  }
  return variants;
}

function safeCropJimp(img: JimpImage, x: number, y: number, w: number, h: number): JimpImage | null {
  const width = img.bitmap.width;
  const height = img.bitmap.height;
  const left = Math.max(0, Math.min(x, width - 1));
  const top = Math.max(0, Math.min(y, height - 1));
  const cropW = Math.max(1, Math.min(w, width - left));
  const cropH = Math.max(1, Math.min(h, height - top));
  if (cropW < 8 || cropH < 8) return null;
  try {
    return img.clone().crop({ x: left, y: top, w: cropW, h: cropH }) as JimpImage;
  } catch {
    return null;
  }
}

async function toScanJpeg(img: JimpImage): Promise<Buffer> {
  const copy = img.clone();
  if (copy.bitmap.width > MAX_EDGE || copy.bitmap.height > MAX_EDGE) {
    copy.scaleToFit({ w: MAX_EDGE, h: MAX_EDGE });
  }
  copy.greyscale();
  copy.normalize();
  copy.contrast(0.12);
  return copy.getBuffer('image/jpeg', { quality: 88 });
}

async function buildScanVariantsJimp(buffer: Buffer): Promise<Buffer[]> {
  const variants: Buffer[] = [];
  try {
    const base = await Jimp.read(buffer);
    const width = base.bitmap.width;
    const height = base.bitmap.height;
    if (!width || !height) return [];

    const topCrop = Math.min(Math.round(height * OVERLAY_TOP_RATIO), Math.floor(height / 4));
    const cropped =
      topCrop > 0 && height - topCrop >= 80
        ? safeCropJimp(base, 0, topCrop, width, height - topCrop)
        : base.clone();
    if (!cropped) return [];

    for (const deg of [0, 90, 270]) {
      try {
        const rotated = cropped.clone();
        if (deg) rotated.rotate(deg);
        variants.push(await toScanJpeg(rotated));
      } catch {
        /* next */
      }
    }

    try {
      const highContrast = cropped.clone().rotate(90) as JimpImage;
      highContrast.contrast(0.35);
      highContrast.threshold({ max: 150 });
      variants.push(await toScanJpeg(highContrast));
    } catch {
      /* skip */
    }
  } catch {
    return [];
  }
  return variants;
}

/**
 * Build image variants: sharp when available (fast), jimp fallback (pure JS).
 * Each step renders to a buffer before rotate/crop to avoid bad extract areas.
 */
export async function buildScanVariants(buffer: Buffer): Promise<Buffer[]> {
  const fn = await loadSharp();
  if (fn) {
    const sharpVariants = await buildScanVariantsSharp(buffer, fn);
    if (sharpVariants.length) return sharpVariants;
  }
  const jimpVariants = await buildScanVariantsJimp(buffer);
  return jimpVariants.length ? jimpVariants : [buffer];
}

async function regionBuffersSharp(buffer: Buffer, fn: SharpConstructor): Promise<Buffer[]> {
  const regions: Buffer[] = [buffer];
  try {
    const meta = await fn(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const half = Math.floor(height / 2);
    if (half < 24 || height - half < 24) return regions;

    regions.push(
      await fn(buffer).extract({ left: 0, top: 0, width, height: half }).jpeg({ quality: 90 }).toBuffer(),
      await fn(buffer).extract({ left: 0, top: half, width, height: height - half }).jpeg({ quality: 90 }).toBuffer(),
    );
  } catch {
    /* full frame only */
  }
  return regions;
}

/** Split image into top/bottom JPEG regions for stacked stickers. */
export async function regionBuffers(buffer: Buffer): Promise<Buffer[]> {
  const fn = await loadSharp();
  if (fn) {
    const regions = await regionBuffersSharp(buffer, fn);
    if (regions.length > 1) return regions;
  }

  const regions: Buffer[] = [buffer];
  try {
    const img = await Jimp.read(buffer);
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    const half = Math.floor(h / 2);
    if (half < 24 || h - half < 24) return regions;

    const top = safeCropJimp(img, 0, 0, w, half);
    const bottom = safeCropJimp(img, 0, half, w, h - half);
    if (top) regions.push(await top.getBuffer('image/jpeg', { quality: 90 }));
    if (bottom) regions.push(await bottom.getBuffer('image/jpeg', { quality: 90 }));
  } catch {
    /* full frame only */
  }
  return regions;
}

/** @deprecated Use buildScanVariants */
export async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  const variants = await buildScanVariants(buffer);
  return variants[0] ?? buffer;
}
