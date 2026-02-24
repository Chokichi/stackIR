import { convert } from 'jcampconverter'
import { xToWavenumbers } from './spectrumUnits'

/**
 * Parse JCAMP-DX spectral data files.
 * Supports AFFN (decimal) and SQZ/DIF (packed) XYDATA formats via jcampconverter.
 * Converts wavelength (MICROMETERS, NANOMETERS) to wavenumber (1/CM) for IR display.
 */
export function parseJDX(text) {
  const result = convert(text, { withoutXY: false })
  const block = result.flatten?.[0]
  const spectrum = block?.spectra?.[0]
  const data = spectrum?.data

  if (!data?.x?.length || !data?.y?.length) {
    throw new Error('No spectral data found in JCAMP-DX file')
  }

  let x = Array.from(data.x)
  const y = Array.from(data.y)
  const rawXUnits = spectrum?.xUnits ?? block?.info?.XUNITS ?? ''

  const converted = xToWavenumbers(x, rawXUnits)
  x = converted.x
  const xUnits = converted.xUnits

  const pairs = x.map((xi, i) => [xi, y[i]])
  pairs.sort((a, b) => a[0] - b[0])
  x = pairs.map((p) => p[0])
  const ySorted = pairs.map((p) => p[1])

  const minX = x[0]
  const maxX = x[x.length - 1]
  const rawYUnits = spectrum?.yUnits ?? block?.info?.YUNITS ?? block?.info?.YLABEL ?? ''
  const yUnits = typeof rawYUnits === 'string' ? rawYUnits.toUpperCase().trim() : ''

  return {
    title: block?.title ?? 'Spectrum',
    xUnits,
    yUnits: yUnits || 'TRANSMITTANCE',
    x,
    y: ySorted,
    minWavenumber: minX,
    maxWavenumber: maxX,
  }
}
