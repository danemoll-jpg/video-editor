// Reimplementation of FFmpeg's real `chromakey` video filter algorithm, used
// by the live preview's canvas compositor (PreviewPlayer.tsx) so a
// similarity/blend setting that looks safe while tuning in the editor
// reliably means it's actually safe on export — see TODO.md's "live-preview
// accuracy fix" entry for why this exists (a real, pixel-verified bug: the
// old preview used a hard RGB-Euclidean-distance cutoff that disagreed
// sharply with FFmpeg's real output on Dan's actual footage) and how it was
// verified (pixel-level comparison against real FFmpeg `chromakey` output —
// see scripts/verifyChromaKey.mjs).
//
// Ported from FFmpeg's actual libavfilter/vf_chromakey.c, studied directly
// (not approximated from the filter's prose documentation). The core
// algorithm — distance measured in YUV **chroma** (U/V) space only, never
// luma, never plain RGB, using the same BT.601 "full-range" RGB->YUV
// coefficients its own RGB_TO_U/RGB_TO_V macros use for the key color
// (rgbToUV below); each pixel's distance averaged over a 3x3 neighborhood;
// and `similarity`/`blend` producing a graduated alpha (below `similarity`
// fully transparent, above `similarity + blend` fully opaque, a linear ramp
// between) — was confirmed identically across three independent source
// fetches (two different upstream revisions), and rgbToUV's own output was
// separately confirmed against the *actual* YUV bytes this app's bundled
// FFmpeg produces for known RGB input (dumping a raw yuv444p frame and
// comparing byte-for-byte), not just trusted from the fetches.
//
// One real trap surfaced while double-checking the normalizing constant
// (255*255*2, below) against isolated calibration colors: an isolated,
// noise-free flat-color test patch measures a meaningfully *smaller*
// distance than the same nominal color sitting inside a real, noisy,
// H.264-compressed clip — not because the constant is wrong, but because
// `diff` is a nonlinear (sqrt of a sum of squares) function of noisy
// per-pixel chroma, and clamping the alpha ramp at 0 makes random noise
// push the *average* alpha up, never down, for any pixel already sitting
// within one blend-width of the threshold. Real footage always has some
// grain/compression noise, so this isn't a synthetic artifact — it's a
// genuine reason a noisy shot keys worse than a clean one, and it's also
// why this preview (like FFmpeg's own filter, run once per frame) can only
// approximate the *expected* look of grainy footage, not reproduce it
// pixel-for-pixel. Chasing that noise-driven gap by shrinking the constant
// instead made a realistic full-clip comparison measurably *worse* (see
// scripts/verifyChromaKey.mjs's notes) — so the literal, three-times-
// corroborated constant is what's used here, not a curve-fit correction for
// an effect that isn't actually a formula error.
//
// Deliberately NOT bit-exact with FFmpeg's fixed-point implementation (see
// vf_chromakey.c's FIXNUM macros) — this runs in floating point. What
// matters for closing the actual trust gap is matching the real *shape* of
// the function and its scale, which this does — see
// scripts/verifyChromaKey.mjs for the pixel-level comparison against real
// FFmpeg output (on a realistic, noisy, compressed synthetic clip) that
// confirms roughly a 9x reduction in mean per-pixel alpha error versus the
// old RGB-hard-cutoff algorithm.

export interface ChromaKeySettings {
  /** '#rrggbb' */
  color: string
  similarity: number
  blend: number
}

/** Minimal shape this module needs from a canvas ImageData — lets the
 * verification script (plain Node, no DOM) build a lookalike object instead
 * of needing a real browser ImageData/canvas. */
export interface PixelBuffer {
  width: number
  height: number
  /** RGBA, one byte per channel, row-major. */
  data: Uint8ClampedArray
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

/**
 * BT.601 full-range RGB->YUV chroma components (U, V) — the exact formula
 * FFmpeg's `RGB_TO_U`/`RGB_TO_V` macros use (in fixed-point) to convert the
 * chosen key color; applied here in floating point to every source pixel
 * too, so both sides of the distance comparison live in the same space.
 */
function rgbToUV(r: number, g: number, b: number): [number, number] {
  const u = -0.16874 * r - 0.33126 * g + 0.5 * b + 128
  const v = 0.5 * r - 0.41869 * g - 0.08131 * b + 128
  return [u, v]
}

/**
 * Normalizing constant for the per-pixel chroma distance formula below —
 * the literal `255.0 * 255.0 * 2` from FFmpeg's real `do_chromakey_pixel`
 * (normalizing the max possible squared chroma distance, each axis 0-255,
 * to a 0..1 `diff` range). See this file's header comment for why this is
 * used as-is rather than curve-fit against isolated calibration colors.
 */
const DISTANCE_NORM = 255 * 255 * 2

/**
 * Applies chroma-key transparency to `buffer.data` in place, following
 * FFmpeg's real `chromakey` filter algorithm (see this file's header).
 * Alpha is assumed fully opaque (255) going in for every pixel — this
 * preview never chains a second alpha-affecting filter before chroma key,
 * unlike FFmpeg's general filter graph (which combines with any
 * pre-existing alpha via a min instead of an overwrite), so a plain
 * overwrite here is equivalent.
 */
export function applyChromaKey(buffer: PixelBuffer, settings: ChromaKeySettings): void {
  const { width, height, data } = buffer
  const n = width * height
  if (n === 0) return

  const [kr, kg, kb] = hexToRgb(settings.color)
  const [keyU, keyV] = rgbToUV(kr, kg, kb)

  // Pass 1: per-pixel normalized chroma distance —
  //   diff = sqrt(((u-keyU)^2 + (v-keyV)^2) / DISTANCE_NORM)
  // — the same shape of formula the real filter evaluates per
  // 3x3-neighborhood sample (see DISTANCE_NORM's own comment for where its
  // constant actually comes from), computed once per pixel here so pass 2
  // can reuse it as a cheap separable box blur instead of resampling 9
  // neighbors per output pixel.
  const diff = new Float32Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const [u, v] = rgbToUV(data[p], data[p + 1], data[p + 2])
    const du = u - keyU
    const dv = v - keyV
    diff[i] = Math.sqrt((du * du + dv * dv) / DISTANCE_NORM)
  }

  // Pass 2: average each pixel's distance over its 3x3 neighborhood
  // (edges clamp to the border, same spirit as sampling out-of-frame chroma
  // at an edge) — a separable box blur (horizontal sum, then vertical sum)
  // rather than a naive 9-sample-per-pixel loop, since this needs to stay
  // real-time for interactive slider tuning.
  const hsum = new Float32Array(n)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const xl = Math.max(0, x - 1)
      const xr = Math.min(width - 1, x + 1)
      hsum[row + x] = diff[row + xl] + diff[row + x] + diff[row + xr]
    }
  }
  const smoothed = new Float32Array(n)
  for (let y = 0; y < height; y++) {
    const yt = Math.max(0, y - 1) * width
    const ym = y * width
    const yb = Math.min(height - 1, y + 1) * width
    for (let x = 0; x < width; x++) {
      smoothed[ym + x] = (hsum[yt + x] + hsum[ym + x] + hsum[yb + x]) / 9
    }
  }

  // Pass 3: similarity/blend -> alpha, matching the real filter's own
  // epsilon-guarded branch (a ~zero blend collapses to a hard cutoff at
  // `similarity`; otherwise a linear ramp across the blend width).
  const { similarity, blend } = settings
  const hasBlend = blend > 0.0001
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const d = smoothed[i]
    const alpha = hasBlend ? Math.max(0, Math.min(1, (d - similarity) / blend)) : d > similarity ? 1 : 0
    data[p + 3] = Math.round(alpha * 255)
  }
}
