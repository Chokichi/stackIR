/**
 * Shimadzu IRsolution / LabSolutions IR .smf reader.
 *
 * An .smf file is a Berkeley DB *hash* database (little-endian, 8 KiB pages).
 * Each record key is "<object> <property>" (e.g. "2 100008 "). In the files
 * from the IRAffinity, object 2 is the processed spectrum and objects 3 and 4
 * are the sample/background interferograms. Properties used here:
 *   100001  x-axis descriptor: units string @12, npoints u32 @76,
 *           first x f64 @96, last x f64 @112, step f64 @128
 *   100003  y-axis descriptor: units string @12 ("%T", "Abs", ...)
 *   100008  y data: npoints little-endian float64 values (first x → last x)
 *   NON_BTREE_DATA  audit trail entries: u32 unix time, then length-prefixed strings
 */

const PAGE_HASH_OLD = 2 // P_HASH_UNSORTED (DB 2.x/3.x hash leaf)
const PAGE_HASH = 13
const PAGE_OVERFLOW = 7
const ITEM_KEYDATA = 1
const ITEM_OFFPAGE = 3
const HASH_MAGIC = 0x061561
const PAGE_HEADER = 26

const latin1 = new TextDecoder('latin1')

/** Read every key/value pair out of a Berkeley DB hash file. */
export function readBerkeleyHash(buffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 512 || view.getUint32(12, true) !== HASH_MAGIC) {
    throw new Error('Not a Shimadzu .smf file (Berkeley DB hash header not found)')
  }
  const pageSize = view.getUint32(20, true)
  if (!pageSize || pageSize % 512 !== 0) throw new Error('Invalid .smf page size')
  const pageCount = Math.floor(bytes.length / pageSize)

  const pageInfo = (pg) => {
    const o = pg * pageSize
    return {
      o,
      next: view.getUint32(o + 16, true),
      entries: view.getUint16(o + 20, true),
      hfOffset: view.getUint16(o + 22, true),
      type: bytes[o + 25],
    }
  }

  const readOverflow = (startPg, totalLen) => {
    const out = new Uint8Array(totalLen)
    let filled = 0
    let pg = startPg
    let guard = 0
    while (pg && filled < totalLen && guard++ < pageCount) {
      if (pg >= pageCount) throw new Error('Corrupt .smf file (overflow page out of range)')
      const p = pageInfo(pg)
      if (p.type !== PAGE_OVERFLOW) throw new Error('Corrupt .smf file (bad overflow chain)')
      const len = Math.min(p.hfOffset, totalLen - filled)
      out.set(bytes.subarray(p.o + PAGE_HEADER, p.o + PAGE_HEADER + len), filled)
      filled += len
      pg = p.next
    }
    return out
  }

  const readItem = (start, end) => {
    const type = bytes[start]
    if (type === ITEM_KEYDATA) return bytes.slice(start + 1, end)
    if (type === ITEM_OFFPAGE) {
      return readOverflow(view.getUint32(start + 4, true), view.getUint32(start + 8, true))
    }
    return null // duplicates are not used by IRsolution
  }

  const records = new Map()
  for (let pg = 1; pg < pageCount; pg++) {
    const p = pageInfo(pg)
    if (p.type !== PAGE_HASH && p.type !== PAGE_HASH_OLD) continue
    const offsets = []
    for (let i = 0; i < p.entries; i++) offsets.push(view.getUint16(p.o + PAGE_HEADER + i * 2, true))
    for (let i = 0; i + 1 < p.entries; i += 2) {
      const keyEnd = i === 0 ? pageSize : offsets[i - 1]
      const key = readItem(p.o + offsets[i], p.o + keyEnd)
      const value = readItem(p.o + offsets[i + 1], p.o + offsets[i])
      if (key && value) records.set(latin1.decode(key).replace(/\0+$/, ''), value)
    }
  }
  return records
}

function cString(bytes, start, maxLen) {
  const slice = bytes.subarray(start, start + maxLen)
  const nul = slice.indexOf(0)
  return latin1.decode(nul === -1 ? slice : slice.subarray(0, nul)).trim()
}

function dv(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

const isPrintable = (bytes) => bytes.every((c) => c === 9 || (c >= 32 && c < 127) || c >= 160)

/** Pull "<timestamp> text / user" entries out of the object's NON_BTREE_DATA blob. */
function readAuditTrail(blob) {
  if (!blob) return []
  const view = dv(blob)
  const entries = []
  const readStr = (pos) => {
    if (pos + 4 > blob.length) return null
    const len = view.getUint32(pos, true)
    if (len > 512 || pos + 4 + len > blob.length) return null
    const s = blob.subarray(pos + 4, pos + 4 + len)
    return isPrintable(s) ? { text: latin1.decode(s), end: pos + 4 + len } : null
  }
  for (let i = 0; i + 8 < blob.length; ) {
    const ts = view.getUint32(i, true)
    // A plausible timestamp (2000–2100) whose bytes aren't themselves ASCII text (e.g. "SHIM").
    const asciiBytes = blob.subarray(i, i + 4).every((c) => c >= 32 && c < 127)
    const plausible = ts > 946684800 && ts < 4102444800 && !asciiBytes
    const msg = plausible ? readStr(i + 4) : null
    if (!msg || msg.text.length < 2) {
      i++
      continue
    }
    const user = readStr(msg.end)
    entries.push({ date: new Date(ts * 1000), text: msg.text, user: user?.text ?? '' })
    i = user ? user.end : msg.end
  }
  return entries
}

/**
 * Decode an .smf file into a spectrum.
 * @returns {{ title, x: number[], y: number[], xUnits, yUnits, rawYUnits, auditTrail }}
 */
export function parseSMF(buffer, fileName = '') {
  const records = readBerkeleyHash(buffer)

  // Find the object whose x-axis is in wavenumbers and has matching y data.
  let obj = null
  const ids = [...records.keys()]
    .map((k) => k.match(/^(\d+) 100001\s*$/)?.[1])
    .filter(Boolean)
    .sort((a, b) => a - b)
  for (const id of ids) {
    const xDesc = records.get(`${id} 100001`) ?? records.get(`${id} 100001 `)
    const yData = records.get(`${id} 100008`) ?? records.get(`${id} 100008 `)
    if (!xDesc || !yData || xDesc.length < 136) continue
    const units = cString(xDesc, 12, 64)
    const n = dv(xDesc).getUint32(76, true)
    if (/^1\/cm$/i.test(units) && n > 1 && yData.length >= n * 8) {
      obj = { id, xDesc, yData, n }
      break
    }
  }
  if (!obj) throw new Error('No IR spectrum found in .smf file')

  const xv = dv(obj.xDesc)
  const firstX = xv.getFloat64(96, true)
  const lastX = xv.getFloat64(112, true)
  const step = (lastX - firstX) / (obj.n - 1)
  const yv = dv(obj.yData)
  const x = new Array(obj.n)
  const y = new Array(obj.n)
  for (let i = 0; i < obj.n; i++) {
    x[i] = firstX + i * step
    y[i] = yv.getFloat64(i * 8, true)
  }

  const yDesc = records.get(`${obj.id} 100003`) ?? records.get(`${obj.id} 100003 `)
  const rawYUnits = yDesc ? cString(yDesc, 12, 64) : '%T'
  const yUnits = /abs/i.test(rawYUnits)
    ? 'ABSORBANCE'
    : /%?\s*R$/i.test(rawYUnits)
      ? 'REFLECTANCE'
      : 'TRANSMITTANCE'

  const auditTrail = readAuditTrail(
    records.get(`${obj.id} NON_BTREE_DATA`) ?? records.get(`${obj.id} NON_BTREE_DATA `),
  )
  // The first audit entry of the spectrum object is the sample name entered at measurement.
  const baseName = fileName.replace(/\.smf$/i, '')
  const title = baseName || auditTrail[0]?.text || 'Spectrum'

  return { title, x, y, xUnits: '1/CM', yUnits, rawYUnits, auditTrail }
}

const pad = (n) => String(n).padStart(2, '0')
const fmtDate = (d) =>
  `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${pad(d.getFullYear() % 100)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** Convert an .smf file to JCAMP-DX 4.24 text (AFFN), mirroring IRsolution's own .dx export header. */
export function smfToJcamp(buffer, fileName = '') {
  const s = parseSMF(buffer, fileName)
  const n = s.x.length
  const minY = Math.min(...s.y)
  const maxY = Math.max(...s.y)
  const deltaX = (s.x[n - 1] - s.x[0]) / (n - 1)

  // Audit entries after the title entry describe the measurement ("Scan on IRAffinity-…").
  const trail = s.auditTrail
    .filter((e, i) => !(i === 0 && e.text === s.title))
    .map((e) => `<${fmtDate(e.date)}>, <${e.user || 'SHIMADZU'}>, <>, <${e.text}>`)

  const lines = [
    `##TITLE=${s.title}`,
    '##JCAMP-DX=4.24',
    '##DATATYPE=INFRARED SPECTRUM',
    '##ORIGIN= ',
    '##OWNER= ',
    '##SOURCEREFERENCE=FTIR Measurement',
    '##XUNITS=1/CM',
    `##YUNITS=${s.yUnits}`,
    `##FIRSTX=${s.x[0].toFixed(4)}`,
    `##LASTX=${s.x[n - 1].toFixed(4)}`,
    `##MINX=${s.x[0].toFixed(2)}`,
    `##MAXX=${s.x[n - 1].toFixed(2)}`,
    `##MINY=${minY.toFixed(2)}`,
    `##MAXY=${maxY.toFixed(2)}`,
    `##DELTAX=${deltaX.toFixed(6)}`,
    '##XFACTOR=1',
    '##YFACTOR=1',
  ]
  if (trail.length) lines.push(`##AUDIT TRAIL=${trail.join('\n')}`)
  lines.push(`##FIRSTY=${s.y[0].toFixed(6)}`, `##NPOINTS=${n}`, '##XYDATA=(X++(Y..Y))')

  const perLine = 8
  for (let i = 0; i < n; i += perLine) {
    const ys = s.y.slice(i, i + perLine).map((v) => v.toFixed(6))
    lines.push(`${s.x[i].toFixed(4)} ${ys.join(' ')}`)
  }
  lines.push('##END=', '')
  return lines.join('\n')
}

/** True when a File/name looks like a Shimadzu .smf file. */
export const isSmfFile = (fileOrName) => /\.smf$/i.test(typeof fileOrName === 'string' ? fileOrName : fileOrName?.name ?? '')

/** Read a File as JCAMP-DX text, decoding .smf files on the fly. */
export function readSpectrumFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const smf = isSmfFile(file)
    reader.onload = () => {
      try {
        resolve(smf ? smfToJcamp(reader.result, file.name) : String(reader.result))
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    if (smf) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  })
}
