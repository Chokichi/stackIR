import { convert } from 'jcampconverter'

/**
 * Parse JCAMP-DX spectral data files.
 * Supports AFFN (decimal) and SQZ/DIF (packed) XYDATA formats via jcampconverter.
 */
export function parseJDX(text) {
  const result = convert(text, { withoutXY: false })
  const block = result.flatten?.[0]
  const spectrum = block?.spectra?.[0]
  const data = spectrum?.data

  if (!data?.x?.length || !data?.y?.length) {
    throw new Error('No spectral data found in JCAMP-DX file')
  }

  const x = Array.from(data.x)
  const y = Array.from(data.y)
  const minX = Math.min(...x)
  const maxX = Math.max(...x)
  const rawYUnits = spectrum?.yUnits ?? block?.info?.YUNITS ?? ''
  const yUnits = typeof rawYUnits === 'string' ? rawYUnits.toUpperCase().trim() : ''

  return {
    title: block?.title ?? 'Spectrum',
    xUnits: spectrum?.xUnits ?? block?.info?.XUNITS ?? '',
    yUnits: yUnits || 'TRANSMITTANCE',
    x,
    y,
    minWavenumber: minX,
    maxWavenumber: maxX,
  }
}
