import { convert } from 'jcampconverter'

/**
 * Standard metadata key order for consistent JCAMP-DX headers.
 * Based on sample-spectra/100-41-4-IR.jdx structure.
 * Missing keys are added with blank values when files are loaded.
 */
const STANDARD_METADATA_ORDER = [
  'TITLE',
  'JCAMP-DX',
  'DATA TYPE',
  'CLASS',
  'ORIGIN',
  'OWNER',
  'DATE',
  'NAMES',
  'CAS REGISTRY NO',
  'FUNCTIONAL GROUPS',
]

/**
 * Parse JCAMP-DX file into editable metadata + data block.
 * Preserves structure for round-trip editing.
 */

const DATA_START_PATTERNS = [
  /^##XYDATA=/i,
  /^##PEAK TABLE=/i,
  /^##XYPOINTS=/i,
  /^##DATA TABLE=/i,
]

export function parseJcampForEditing(text) {
  const lines = text.split(/\r?\n/)
  const headerEntries = []
  let dataStartIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const dataMatch = DATA_START_PATTERNS.some((p) => p.test(line))
    if (dataMatch) {
      dataStartIndex = i
      break
    }
    const metaMatch = line.match(/^##([^=]+)=(.*)$/)
    if (metaMatch) {
      let value = metaMatch[2].trim()
      // Continuation lines: + prefix (JCAMP spec) OR lines not starting with ## (e.g. Shimadzu)
      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        const isDataStart = DATA_START_PATTERNS.some((p) => p.test(next))
        if (isDataStart || next.startsWith('##')) break
        i++
        const cont = /^\s*\+/.test(lines[i]) ? lines[i].replace(/^\s*\+/, '').trimEnd() : lines[i]
        value = value ? `${value}\n${cont}` : cont
      }
      headerEntries.push({
        type: 'metadata',
        key: metaMatch[1].trim(),
        value,
      })
    } else {
      headerEntries.push({ type: 'raw', content: line })
    }
  }

  const dataBlock = dataStartIndex >= 0 ? lines.slice(dataStartIndex).join('\n') : ''

  return { headerEntries, dataBlock }
}

/**
 * Standardize header entries: ensure standard metadata keys exist (with blank
 * values if missing) and reorder metadata to match STANDARD_METADATA_ORDER.
 * Raw lines (e.g. copyright) are kept first, then standard keys, then any extras.
 */
export function normalizeHeaderEntries(headerEntries) {
  const rawEntries = headerEntries.filter((e) => e.type === 'raw')
  const metadataByKey = new Map()
  const extraKeyOrder = []

  for (const e of headerEntries) {
    if (e.type === 'metadata') {
      if (!metadataByKey.has(e.key)) {
        metadataByKey.set(e.key, e)
        if (!STANDARD_METADATA_ORDER.includes(e.key)) {
          extraKeyOrder.push(e.key)
        }
      }
    }
  }

  const result = [...rawEntries]

  for (const key of STANDARD_METADATA_ORDER) {
    const existing = metadataByKey.get(key)
    result.push(
      existing ?? { type: 'metadata', key, value: '' }
    )
  }

  for (const key of extraKeyOrder) {
    result.push(metadataByKey.get(key))
  }

  return result
}

export function serializeJcampForEditing({ headerEntries, dataBlock }) {
  const headerLines = []
  for (const e of headerEntries) {
    if (e.type === 'metadata') {
      const value = e.value ?? ''
      if (value.includes('\n')) {
        const parts = value.split('\n')
        headerLines.push(`##${e.key}=${parts[0]}`)
        for (let i = 1; i < parts.length; i++) {
          headerLines.push(`+${parts[i]}`)
        }
      } else {
        headerLines.push(`##${e.key}=${value}`)
      }
    } else {
      headerLines.push(e.content)
    }
  }
  return [...headerLines, dataBlock].filter(Boolean).join('\n')
}

/**
 * Decode compressed ASDF/SQZ/DIF data block using jcampconverter.
 * Returns human-readable AFFN format (x y pairs) or null if decoding fails.
 */
export function decodeDataBlockToAffn(fullFileText) {
  try {
    const result = convert(fullFileText, { withoutXY: false })
    const block = result.flatten?.[0]
    const spectrum = block?.spectra?.[0]
    const data = spectrum?.data

    if (!data?.x?.length || !data?.y?.length) return null

    const x = Array.from(data.x)
    const y = Array.from(data.y)

    // Output as (XY..XY) AFFN: x,y pairs, ~5 per line for readability (~80 char lines)
    const formatVal = (v) => {
      if (Number.isInteger(v)) return String(v)
      const s = v < 1e-4 || v >= 1e6 ? v.toExponential(6) : v.toFixed(6).replace(/\.?0+$/, '')
      return s
    }
    const lines = []
    const pairsPerLine = 5
    for (let i = 0; i < x.length; i += pairsPerLine) {
      const chunk = []
      for (let j = i; j < Math.min(i + pairsPerLine, x.length); j++) {
        chunk.push(`${formatVal(x[j])},${formatVal(y[j])}`)
      }
      lines.push(chunk.join(' '))
    }

    return `##XYPOINTS=(XY..XY)\n${lines.join('\n')}\n##END=`
  } catch {
    return null
  }
}
