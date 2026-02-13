/**
 * Convert between absorbance (A) and transmittance (T).
 * A = -log10(T),  T = 10^(-A)
 * Transmittance is 0–1 (0–100%). Absorbance is 0 to ∞.
 */

const ABSORBANCE_KEYS = ['ABSORBANCE', 'A', 'ABS']
const TRANSMITTANCE_KEYS = ['TRANSMITTANCE', 'TRANSMISSION', 'T', 'T%', '%T', 'PERCENT TRANSMITTANCE']

export function isAbsorbance(yUnits) {
  if (!yUnits || typeof yUnits !== 'string') return false
  const u = yUnits.toUpperCase().trim()
  return ABSORBANCE_KEYS.some((k) => u.includes(k))
}

export function isTransmittance(yUnits) {
  if (!yUnits || typeof yUnits !== 'string') return true
  const u = yUnits.toUpperCase().trim()
  return TRANSMITTANCE_KEYS.some((k) => u.includes(k))
}

/** Convert absorbance to transmittance (0–1). */
export function absorbanceToTransmittance(a) {
  if (a <= 0) return 1
  return Math.pow(10, -a)
}

/** Convert transmittance (0–1 or 0–100) to absorbance. */
export function transmittanceToAbsorbance(t) {
  const T = t > 1 ? t / 100 : Math.max(1e-10, t)
  return -Math.log10(T)
}

/**
 * Get Y values in the requested display units.
 * @param {number[]} y - raw Y values
 * @param {string} dataYUnits - units of y (e.g. 'ABSORBANCE', 'TRANSMITTANCE')
 * @param {'transmittance'|'absorbance'} displayUnits - desired display units
 * @returns {number[]} y values in display units
 */
export function getDisplayY(y, dataYUnits, displayUnits) {
  if (!y?.length) return []
  const dataIsA = isAbsorbance(dataYUnits)
  const wantA = displayUnits === 'absorbance'

  if (dataIsA && wantA) return [...y]
  if (!dataIsA && !wantA) return [...y]
  if (dataIsA && !wantA) return y.map(absorbanceToTransmittance)
  return y.map((v) => transmittanceToAbsorbance(v > 1 ? v / 100 : v))
}
