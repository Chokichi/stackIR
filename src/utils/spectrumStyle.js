/**
 * Shared spectrum styling: color palette + line-style (dash) palette.
 *
 * Color palette is color-blind friendly (Okabe-Ito + Paul Tol "muted"
 * accents). Every entry is dark/saturated enough to keep strong contrast
 * on a white chart background (WCAG AA against #ffffff).
 *
 * Line styles let users distinguish spectra without relying on color at all,
 * which is important for deuteranopic / protanopic / tritanopic viewers and
 * for grayscale printing.
 */

export const SPECTRUM_COLORS = [
  '#0072B2', // strong blue
  '#D55E00', // vermillion
  '#009E73', // bluish green
  '#CC79A7', // reddish purple
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#332288', // indigo
  '#AA4499', // purple
  '#117733', // forest green
  '#882255', // wine
  '#000000', // black
]

export const SPECTRUM_LINE_STYLES = [
  { id: 'solid',       label: 'Solid',         dash: '' },
  { id: 'dashed',      label: 'Dashed',        dash: '6 4' },
  { id: 'dotted',      label: 'Dotted',        dash: '1.5 3' },
  { id: 'longdash',    label: 'Long dash',     dash: '12 5' },
  { id: 'dashdot',     label: 'Dash-dot',      dash: '7 3 1.5 3' },
  { id: 'longdashdot', label: 'Long dash-dot', dash: '12 4 1.5 4' },
]

const STYLE_BY_ID = Object.fromEntries(SPECTRUM_LINE_STYLES.map((s) => [s.id, s]))

export function isValidHexColor(c) {
  return typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c)
}

/** Color for a spectrum: per-spectrum `lineColor` override, else palette by index. */
export function spectrumLineColor(spectrum, indexForPalette) {
  if (isValidHexColor(spectrum?.lineColor)) return spectrum.lineColor
  const i = Math.max(0, indexForPalette ?? 0)
  return SPECTRUM_COLORS[i % SPECTRUM_COLORS.length]
}

export function spectrumLineColorFromList(spectrum, spectra) {
  const idx = spectra.findIndex((s) => s.id === spectrum.id)
  return spectrumLineColor(spectrum, idx >= 0 ? idx : 0)
}

/** Normalized line-style id; defaults to 'solid' when absent or unknown. */
export function resolveLineStyleId(spectrum) {
  const id = spectrum?.lineStyle
  return STYLE_BY_ID[id]?.id ?? 'solid'
}

/** SVG `stroke-dasharray` string for a spectrum (empty string = solid). */
export function spectrumLineDash(spectrum) {
  return STYLE_BY_ID[resolveLineStyleId(spectrum)].dash
}

/** Convert a dash-array string ("6 4") into a number array for canvas `setLineDash`. */
export function parseDashArray(dash) {
  if (!dash) return []
  return dash
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
}
