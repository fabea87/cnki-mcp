/**
 * Jigsaw offset solver (anji-plus / blockPuzzle captcha).
 *
 * background: full W×H image with a darkened puzzle-shaped hole
 * piece:      w×H image whose non-transparent pixels form the piece silhouette
 *
 * The hole is the same texture, only darkened, so zero-mean normalised
 * cross-correlation (NCC) over the alpha mask is invariant to that and peaks at
 * the true offset. Pure arithmetic — no native deps.
 */
import { PNG } from "pngjs";

export type Offset = { x: number; score: number; width: number; height: number };

type Img = { w: number; h: number; lum: Float64Array; alpha?: Uint8Array };

function decode(b64: string): Img {
  const png = PNG.sync.read(Buffer.from(b64, "base64"));
  const { width: w, height: h, data } = png;
  const lum = new Float64Array(w * h);
  const hasAlpha = data.some((_, i) => i % 4 === 3 && data[i]! < 255);
  const alpha = hasAlpha ? new Uint8Array(w * h) : undefined;
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    if (alpha) alpha[i] = data[p + 3]!;
  }
  return { w, h, lum, alpha };
}

export function solveOffset(backgroundB64: string, pieceB64: string): Offset {
  const bg = decode(backgroundB64);
  const pc = decode(pieceB64);

  // Sample coordinates inside the piece silhouette.
  const pts: Array<[number, number]> = [];
  if (pc.alpha) {
    for (let y = 0; y < pc.h; y++) {
      for (let x = 0; x < pc.w; x++) {
        if ((pc.alpha[y * pc.w + x] ?? 0) > 128) pts.push([x, y]);
      }
    }
  }
  // No alpha (opaque piece): use a centred grid.
  if (pts.length === 0) {
    for (let y = 2; y < pc.h - 2; y += 2) for (let x = 2; x < pc.w - 2; x += 2) pts.push([x, y]);
  }

  const pieceVals = pts.map(([x, y]) => pc.lum[y * pc.w + x]!);
  const n = pts.length;
  const meanP = pieceVals.reduce((a, b) => a + b, 0) / n;
  let varP = 0;
  for (const v of pieceVals) varP += (v - meanP) ** 2;
  if (varP === 0) return { x: 0, score: -1, width: bg.w, height: bg.h };

  const maxX = Math.max(0, bg.w - pc.w);
  let bestX = 0;
  let bestScore = -Infinity;

  for (let ox = 0; ox <= maxX; ox++) {
    let sumBg = 0;
    let sumProd = 0;
    let sumBgSq = 0;
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i]!;
      const b = bg.lum[py * bg.w + (ox + px)];
      if (b === undefined) {
        sumBg = NaN;
        break;
      }
      sumBg += b;
      sumProd += b * pieceVals[i]!;
      sumBgSq += b * b;
    }
    if (Number.isNaN(sumBg)) continue;
    const meanB = sumBg / n;
    const cov = sumProd - n * meanB * meanP;
    const varB = sumBgSq - n * meanB * meanB;
    const denom = Math.sqrt(varB * varP);
    const score = denom > 0 ? cov / denom : 0;
    if (score > bestScore) {
      bestScore = score;
      bestX = ox;
    }
  }

  return { x: bestX, score: bestScore, width: bg.w, height: bg.h };
}
