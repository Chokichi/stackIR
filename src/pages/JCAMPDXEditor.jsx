import { useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { parseJcampForEditing, serializeJcampForEditing, decodeDataBlockToAffn } from '../utils/jcampEditorUtils'
import './JCAMPDXEditor.css'

const KNOWN_KEYS = [
  'TITLE',
  'AUDIT TRAIL',
  'JCAMP-DX',
  'DATA TYPE',
  'ORIGIN',
  'OWNER',
  'CAS REGISTRY NO',
  'FUNCTIONAL GROUPS',
  'DATE',
  'XUNITS',
  'YUNITS',
  'XLABEL',
  'YLABEL',
  'MOLFORM',
  'STATE',
  'NAMES',
  'CLASS',
  'SAMPLE DESCRIPTION',
  'CAS NAME',
  'CITATION',
  'SOURCE REFERENCE',
  'SPECTROMETER/DATA SYSTEM',
  'INSTRUMENT PARAMETERS',
  'SAMPLING PROCEDURE',
  'DATA PROCESSING',
  'RESOLUTION',
  'PATH LENGTH',
  'XFACTOR',
  'YFACTOR',
  'DELTAX',
  'FIRSTX',
  'LASTX',
  'FIRSTY',
  'MAXX',
  'MINX',
  'MAXY',
  'MINY',
  'NPOINTS',
]

/** Labels that may appear more than once per block (e.g. in compound/NTUPLES files). */
const REPEATABLE_KEYS = []

/** Brief formatting guides per JCAMP-DX spec. Keys normalized to uppercase for lookup. */
const KEY_FORMAT_GUIDES = {
  TITLE: 'Concise spectrum description, suitable as plot title. Free text.',
  'JCAMP-DX': 'Version, e.g. 4.24.',
  'DATA TYPE': 'E.g. INFRARED SPECTRUM, RAMAN SPECTRUM.',
  ORIGIN: 'Organization, address, contributor. Required.',
  OWNER: 'Owner or copyright holder. Use "PUBLIC DOMAIN" if freely copyable. Required.',
  'CAS REGISTRY NO': 'CAS number, e.g. 111-36-4.',
  'FUNCTIONAL GROUPS': 'Comma-separated list, e.g. Ester, Carbonyl, Aromatic.',
  DATE: 'YY/MM/DD (year/month/day).',
  TIME: 'HH:MM:SS.',
  XUNITS: 'Abscissa units: 1/CM, MICROMETERS, NANOMETERS, SECONDS.',
  YUNITS: 'Ordinate: TRANSMITTANCE, ABSORBANCE, REFLECTANCE, ARBITRARY UNITS.',
  XLABEL: 'Axis label, e.g. Wavenumbers (cm⁻¹).',
  YLABEL: 'Axis label, e.g. % Transmission.',
  MOLFORM: 'C first, then H, then others alphabetically. E.g. C4 H8 O2.',
  STATE: 'Sample state: solid, liquid, gas, solution, etc.',
  NAMES: 'Common or trade names. Multiple names on separate lines.',
  CLASS: 'Coblentz class (1–4) and IUPAC class (A, B, C).',
  'SAMPLE DESCRIPTION': 'Composition, origin, appearance. Free text.',
  'CAS NAME': 'Chemical Abstracts name. Greek spelled out, / for subscript, ^ for superscript.',
  'CITATION': 'Reference citation for the spectrum. Free text or formatted reference.',
  'SOURCE REFERENCE': 'File name, library name, serial number.',
  'SPECTROMETER/DATA SYSTEM': 'Manufacturer, model, software.',
  'INSTRUMENT PARAMETERS': 'Pertinent instrumental settings.',
  'SAMPLING PROCEDURE': 'MODE first (transmission, ATR, etc.), then accessories, cell, etc.',
  'DATA PROCESSING': 'Background, smoothing, etc.',
  RESOLUTION: 'Nominal resolution in XUNITS. Single number or R₁,X₁; R₂,X₂.',
  'PATH LENGTH': 'Cell path in cm, e.g. 0.012.',
  XFACTOR: 'Factor to multiply X-values. Often 1.0.',
  YFACTOR: 'Factor to multiply Y-values. E.g. 0.001 for absorbance.',
  DELTAX: 'Nominal X spacing between points.',
  FIRSTX: 'First abscissa value in data.',
  LASTX: 'Last abscissa value in data.',
  FIRSTY: 'First ordinate value in data.',
  MAXX: 'Maximum X in spectrum.',
  MINX: 'Minimum X in spectrum.',
  MAXY: 'Maximum Y in spectrum.',
  MINY: 'Minimum Y in spectrum.',
  NPOINTS: 'Number of data points.',
  'AUDIT TRAIL': 'Provenance and processing history. Multi-line free text.',
}

function getFormatGuide(key) {
  if (!key || typeof key !== 'string') return null
  return KEY_FORMAT_GUIDES[key.toUpperCase().trim()] ?? null
}

export default function JCAMPDXEditor() {
  const [fileName, setFileName] = useState('')
  const [originalFileText, setOriginalFileText] = useState('')
  const [headerEntries, setHeaderEntries] = useState([])
  const [dataBlock, setDataBlock] = useState('')
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [originalAuditTrail, setOriginalAuditTrail] = useState('')
  const [auditTrailAdditions, setAuditTrailAdditions] = useState([])
  const [auditTrailNewEntry, setAuditTrailNewEntry] = useState('')

  const handleFileSelect = useCallback((e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    setError('')
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result)
        setOriginalFileText(text)
        const { headerEntries: entries, dataBlock: block } = parseJcampForEditing(text)
        const auditEntry = entries.find((e) => e.type === 'metadata' && e.key === 'AUDIT TRAIL')
        setOriginalAuditTrail(auditEntry?.value ?? '')
        setAuditTrailAdditions([])
        setAuditTrailNewEntry('')
        setHeaderEntries(entries)
        setDataBlock(block)
      } catch (err) {
        setError(err.message || 'Failed to parse file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [])

  const updateEntry = useCallback((index, field, value) => {
    setHeaderEntries((prev) => {
      const entry = prev[index]
      if (entry?.type !== 'metadata') return prev
      const next = [...prev]
      next[index] = { ...entry, [field]: value }
      return next
    })
  }, [])

  const removeEntry = useCallback((index) => {
    setHeaderEntries((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const addEntry = useCallback(() => {
    const key = newKey.trim()
    if (!key) return
    setHeaderEntries((prev) => {
      const existing = prev.find((e) => e.type === 'metadata' && e.key === key)
      if (existing) return prev
      const insert = { type: 'metadata', key, value: newValue.trim() }
      return [...prev, insert]
    })
    setNewKey('')
    setNewValue('')
  }, [newKey, newValue])

  const addAuditTrailEntry = useCallback(() => {
    const entry = auditTrailNewEntry.trim()
    if (!entry) return
    setAuditTrailAdditions((prev) => [...prev, entry])
    setAuditTrailNewEntry('')
    setHeaderEntries((prev) => {
      const combined = [...auditTrailAdditions, entry].join('\n')
      const value = originalAuditTrail ? `${originalAuditTrail}\n${combined}` : combined
      const existingIdx = prev.findIndex((e) => e.type === 'metadata' && e.key === 'AUDIT TRAIL')
      if (existingIdx >= 0) {
        const next = [...prev]
        next[existingIdx] = { ...next[existingIdx], value }
        return next
      }
      return [...prev, { type: 'metadata', key: 'AUDIT TRAIL', value }]
    })
  }, [auditTrailNewEntry, auditTrailAdditions, originalAuditTrail])

  const handleDownload = useCallback(() => {
    const content = serializeJcampForEditing({ headerEntries, dataBlock })
    const blob = new Blob([content], { type: 'text/plain' })
    const base = fileName.replace(/\.(jdx|jcamp|dx)$/i, '') || 'edited'
    const name = `${base}_edited.jdx`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }, [headerEntries, dataBlock, fileName])

  const handleDecodeAndDownload = useCallback(() => {
    if (!originalFileText) return
    const decodedBlock = decodeDataBlockToAffn(originalFileText)
    if (!decodedBlock) {
      setError('Could not decode data. File may already be in readable format.')
      return
    }
    const content = serializeJcampForEditing({ headerEntries, dataBlock: decodedBlock })
    const blob = new Blob([content], { type: 'text/plain' })
    const base = fileName.replace(/\.(jdx|jcamp|dx)$/i, '') || 'decoded'
    const name = `${base}_decoded.jdx`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
    setError('')
  }, [originalFileText, headerEntries, fileName])

  const hasData = headerEntries.length > 0 || dataBlock.length > 0
  const isLikelyCompressed = dataBlock.length > 0 && /[A-Za-z%@]/.test(dataBlock) && !/^\d[\d.\s]*$/.test(dataBlock.split('\n')[1]?.trim() ?? '')

  const presentKeys = useMemo(
    () => new Set(headerEntries.filter((e) => e.type === 'metadata').map((e) => e.key)),
    [headerEntries]
  )

  const availableAddKeys = useMemo(
    () => KNOWN_KEYS.filter((k) => k !== 'AUDIT TRAIL' && (!presentKeys.has(k) || REPEATABLE_KEYS.includes(k))),
    [presentKeys]
  )

  const auditTrailEntry = useMemo(
    () => headerEntries.find((e) => e.type === 'metadata' && e.key === 'AUDIT TRAIL'),
    [headerEntries]
  )
  const auditTrailDisplayValue = (auditTrailEntry?.value ?? originalAuditTrail) || ''

  return (
    <div className="app jcamp-editor">
      <header className="header">
        <nav className="nav-links">
          <Link to="/" className="nav-link">Spectra Stacking</Link>
          <Link to="/background-remover" className="nav-link">Background Remover</Link>
          <Link to="/jcamp-editor" className="nav-link active">JCAMP-DX Editor</Link>
        </nav>
        <h1>JCAMP-DX File Editor</h1>
        <p className="subtitle">
          Add, edit, or remove metadata in JCAMP-DX spectrum files. Upload a file to get started.
        </p>
      </header>

      <div className="jcamp-editor-upload">
        <input
          type="file"
          accept=".jdx,.jcamp,.dx"
          onChange={handleFileSelect}
          className="file-input-hidden"
          id="jcamp-file-input"
        />
        <button
          type="button"
          onClick={() => document.getElementById('jcamp-file-input')?.click()}
          className="primary"
        >
          Upload JCAMP-DX file
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {hasData && (
        <div className="jcamp-editor-workspace">
          <div className="jcamp-metadata-section">
            <h2>Metadata</h2>
            <div className="jcamp-entries">
              {headerEntries.map((entry, i) =>
                entry.key === 'AUDIT TRAIL' ? null : entry.type === 'metadata' ? (
                  <div key={`${i}-${entry.key}`} className="jcamp-entry">
                    <label
                      className="jcamp-entry-key"
                      title={getFormatGuide(entry.key) ?? undefined}
                    >
                      ##{entry.key}=
                    </label>
                    <input
                      type="text"
                      value={entry.value}
                      onChange={(e) => updateEntry(i, 'value', e.target.value)}
                      className="jcamp-entry-value"
                    />
                    <button
                      type="button"
                      onClick={() => removeEntry(i)}
                      className="ghost small jcamp-remove"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div key={`raw-${i}`} className="jcamp-raw-line">
                    {entry.content || ' '}
                  </div>
                )
              )}
            </div>

            <div className="jcamp-audit-trail-section">
              <h3>##AUDIT TRAIL=</h3>
              <p className="jcamp-audit-trail-hint">Read-only from file. Add new entries below.</p>
              <textarea
                readOnly
                className="jcamp-audit-trail-display"
                value={auditTrailDisplayValue || '(No audit trail in file)'}
                spellCheck={false}
                aria-label="Audit trail from file"
              />
              <div className="jcamp-audit-trail-add">
                <textarea
                  placeholder="Add an entry to the audit trail..."
                  value={auditTrailNewEntry}
                  onChange={(e) => setAuditTrailNewEntry(e.target.value)}
                  className="jcamp-audit-trail-input"
                  rows={3}
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={addAuditTrailEntry}
                  className="secondary"
                  disabled={!auditTrailNewEntry.trim()}
                >
                  Add to audit trail
                </button>
              </div>
            </div>

            <div className="jcamp-add-section">
              <h3>Add field</h3>
              <div className="jcamp-add-row">
                <input
                  type="text"
                  placeholder="Key (e.g. CAS REGISTRY NO)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="jcamp-add-key"
                  list="available-keys"
                />
                <datalist id="available-keys">
                  {availableAddKeys.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
                <input
                  type="text"
                  placeholder="Value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addEntry()}
                  className="jcamp-add-value"
                />
                <button type="button" onClick={addEntry} className="secondary">
                  Add
                </button>
              </div>
              {getFormatGuide(newKey) && (
                <p className="jcamp-format-guide">{getFormatGuide(newKey)}</p>
              )}
            </div>
          </div>

          <div className="jcamp-data-section">
            <h2>Data block</h2>
            <textarea
              readOnly
              className="jcamp-data-preview"
              value={dataBlock || '(empty)'}
              spellCheck={false}
              aria-label="Data block preview"
            />
            <p className="jcamp-data-hint">Spectral data is preserved as-is. Only metadata above is editable.</p>
          </div>
        </div>
      )}

      {hasData && (
        <div className="jcamp-editor-footer">
          <button type="button" onClick={handleDownload} className="primary">
            Download edited file
          </button>
          <button
            type="button"
            onClick={handleDecodeAndDownload}
            className="secondary"
            title={isLikelyCompressed ? 'Convert compressed ASDF/SQZ/DIF data to readable AFFN format' : 'Convert to readable format (may already be readable)'}
          >
            Decode & download
          </button>
        </div>
      )}
    </div>
  )
}
