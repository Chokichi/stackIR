import { useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import JSZip from 'jszip'
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

const GROUP_EDIT_KEYS = ['ORIGIN', 'OWNER', 'CITATION', 'SOURCE REFERENCE', 'DATE']

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

function applyGroupEditsToEntries(headerEntries, groupEdits) {
  const edits = { ...groupEdits }
  const result = headerEntries.map((e) => {
    if (e.type !== 'metadata') return e
    const key = e.key
    if (key in edits && String(edits[key]).trim() !== '') {
      const value = edits[key]
      delete edits[key]
      return { ...e, value }
    }
    return e
  })
  for (const [key, value] of Object.entries(edits)) {
    if (value !== undefined && String(value).trim() !== '') {
      result.push({ type: 'metadata', key, value })
    }
  }
  return result
}

function parseFileToEntry(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result)
        const { headerEntries, dataBlock } = parseJcampForEditing(text)
        const auditEntry = headerEntries.find((e) => e.type === 'metadata' && e.key === 'AUDIT TRAIL')
        resolve({
          id: crypto.randomUUID(),
          fileName: file.name,
          originalFileText: text,
          headerEntries: [...headerEntries],
          dataBlock,
          originalAuditTrail: auditEntry?.value ?? '',
          auditTrailAdditions: [],
        })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

export default function JCAMPDXEditor() {
  const [files, setFiles] = useState([])
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [editMode, setEditMode] = useState('group')
  const [groupEdits, setGroupEdits] = useState({})
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [auditTrailNewEntry, setAuditTrailNewEntry] = useState('')
  const [applyMessage, setApplyMessage] = useState(null)

  const isBatchMode = files.length > 1
  const currentFile = files[currentFileIndex] ?? null

  const headerEntries = currentFile?.headerEntries ?? []
  const dataBlock = currentFile?.dataBlock ?? ''
  const fileName = currentFile?.fileName ?? ''
  const originalFileText = currentFile?.originalFileText ?? ''
  const originalAuditTrail = currentFile?.originalAuditTrail ?? ''
  const auditTrailAdditions = currentFile?.auditTrailAdditions ?? []

  const handleFileSelect = useCallback((e) => {
    const fileList = e.target?.files
    if (!fileList?.length) return
    setError('')
    const arr = Array.from(fileList)
    Promise.all(arr.map((f) => parseFileToEntry(f)))
      .then((entries) => {
        setFiles(entries)
        setCurrentFileIndex(0)
        setEditMode('group')
        setGroupEdits({})
      })
      .catch((err) => setError(err.message || 'Failed to parse files'))
    e.target.value = ''
  }, [])

  const updateEntry = useCallback(
    (index, field, value) => {
      if (!currentFile) return
      setFiles((prev) => {
        const next = [...prev]
        const idx = prev.findIndex((f) => f.id === currentFile.id)
        if (idx < 0) return prev
        const entry = next[idx].headerEntries[index]
        if (entry?.type !== 'metadata') return prev
        next[idx] = {
          ...next[idx],
          headerEntries: next[idx].headerEntries.map((e, i) =>
            i === index ? { ...e, [field]: value } : e
          ),
        }
        return next
      })
    },
    [currentFile]
  )

  const removeEntry = useCallback(
    (index) => {
      if (!currentFile) return
      setFiles((prev) => {
        const next = [...prev]
        const idx = prev.findIndex((f) => f.id === currentFile.id)
        if (idx < 0) return prev
        next[idx] = {
          ...next[idx],
          headerEntries: next[idx].headerEntries.filter((_, i) => i !== index),
        }
        return next
      })
    },
    [currentFile]
  )

  const addEntry = useCallback(() => {
    const key = newKey.trim()
    if (!key) return
    if (!currentFile) return
    setFiles((prev) => {
      const next = [...prev]
      const idx = prev.findIndex((f) => f.id === currentFile.id)
      if (idx < 0) return prev
      const entries = next[idx].headerEntries
      const existing = entries.find((e) => e.type === 'metadata' && e.key === key)
      if (existing) return prev
      next[idx] = {
        ...next[idx],
        headerEntries: [...entries, { type: 'metadata', key, value: newValue.trim() }],
      }
      return next
    })
    setNewKey('')
    setNewValue('')
  }, [newKey, newValue, currentFile])

  const addAuditTrailEntry = useCallback(() => {
    const entry = auditTrailNewEntry.trim()
    if (!entry || !currentFile) return
    setAuditTrailNewEntry('')
    setFiles((prev) => {
      const next = [...prev]
      const idx = prev.findIndex((f) => f.id === currentFile.id)
      if (idx < 0) return prev
      const additions = [...(next[idx].auditTrailAdditions ?? []), entry]
      const combined = additions.join('\n')
      const value = next[idx].originalAuditTrail
        ? `${next[idx].originalAuditTrail}\n${combined}`
        : combined
      const entries = next[idx].headerEntries
      const auditIdx = entries.findIndex((e) => e.type === 'metadata' && e.key === 'AUDIT TRAIL')
      const newEntries = [...entries]
      if (auditIdx >= 0) {
        newEntries[auditIdx] = { ...newEntries[auditIdx], value }
      } else {
        newEntries.push({ type: 'metadata', key: 'AUDIT TRAIL', value })
      }
      next[idx] = {
        ...next[idx],
        headerEntries: newEntries,
        auditTrailAdditions: additions,
      }
      return next
    })
  }, [auditTrailNewEntry, currentFile])

  const handleApplyGroupEdits = useCallback(() => {
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        headerEntries: applyGroupEditsToEntries(f.headerEntries, groupEdits),
      }))
    )
    setApplyMessage('Applied to all files')
    setTimeout(() => setApplyMessage(null), 2000)
  }, [groupEdits])

  const handleApplyIndividual = useCallback(() => {
    setApplyMessage('Changes saved')
    setTimeout(() => setApplyMessage(null), 2000)
  }, [])

  const handleClear = useCallback(() => {
    if (files.length === 0) return
    const confirmed = window.confirm(
      'Clear all uploaded files? Any unsaved changes will be lost.'
    )
    if (confirmed) {
      setFiles([])
      setCurrentFileIndex(0)
      setEditMode('group')
      setGroupEdits({})
      setError('')
    }
  }, [files.length])

  const handleDownload = useCallback(() => {
    if (files.length === 0) return
    if (files.length === 1) {
      const f = files[0]
      const content = serializeJcampForEditing({
        headerEntries: f.headerEntries,
        dataBlock: f.dataBlock,
      })
      const blob = new Blob([content], { type: 'text/plain' })
      const base = f.fileName.replace(/\.(jdx|jcamp|dx)$/i, '') || 'edited'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${base}_edited.jdx`
      a.click()
      URL.revokeObjectURL(a.href)
    } else {
      const zip = new JSZip()
      files.forEach((f) => {
        const content = serializeJcampForEditing({
          headerEntries: f.headerEntries,
          dataBlock: f.dataBlock,
        })
        const base = f.fileName.replace(/\.(jdx|jcamp|dx)$/i, '') || 'edited'
        zip.file(`${base}_edited.jdx`, content)
      })
      zip.generateAsync({ type: 'blob' }).then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'jcamp-edited.zip'
        a.click()
        URL.revokeObjectURL(a.href)
      })
    }
  }, [files])

  const handleDecodeAndDownload = useCallback(() => {
    if (files.length === 0) return
    const toDecode = files.length === 1 ? files[0] : files[currentFileIndex]
    if (!toDecode?.originalFileText) return
    const decodedBlock = decodeDataBlockToAffn(toDecode.originalFileText)
    if (!decodedBlock) {
      setError('Could not decode data. File may already be in readable format.')
      return
    }
    const content = serializeJcampForEditing({
      headerEntries: toDecode.headerEntries,
      dataBlock: decodedBlock,
    })
    const blob = new Blob([content], { type: 'text/plain' })
    const base = toDecode.fileName.replace(/\.(jdx|jcamp|dx)$/i, '') || 'decoded'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${base}_decoded.jdx`
    a.click()
    URL.revokeObjectURL(a.href)
    setError('')
  }, [files, currentFileIndex])

  const hasData = files.length > 0
  const isLikelyCompressed =
    dataBlock.length > 0 &&
    /[A-Za-z%@]/.test(dataBlock) &&
    !/^\d[\d.\s]*$/.test(dataBlock.split('\n')[1]?.trim() ?? '')

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

  const setGroupEdit = useCallback((key, value) => {
    setGroupEdits((prev) => {
      const next = { ...prev }
      if (value === '' || value == null) delete next[key]
      else next[key] = value
      return next
    })
  }, [])

  const getGroupEditValue = useCallback(
    (key) => {
      if (key in groupEdits) return groupEdits[key]
      const sourceEntries = files[0]?.headerEntries ?? headerEntries
      const entry = sourceEntries.find((e) => e.type === 'metadata' && e.key === key)
      return entry?.value ?? ''
    },
    [groupEdits, files, headerEntries]
  )

  return (
    <div
      className={`app jcamp-editor ${isBatchMode && editMode === 'group' ? 'jcamp-editor--group-mode' : ''}`}
    >
      <header className="header">
        <nav className="nav-links">
          <Link to="/" className="nav-link">Spectra Stacking</Link>
          <Link to="/background-remover" className="nav-link">Background Remover</Link>
          <Link to="/jcamp-editor" className="nav-link active">JCAMP-DX Editor</Link>
        </nav>
        <h1>JCAMP-DX File Editor</h1>
        <p className="subtitle">
          {isBatchMode
            ? `Editing ${files.length} files. Use Group edit for shared metadata, Individual for per-file changes.`
            : 'Add, edit, or remove metadata in JCAMP-DX spectrum files. Upload a file to get started.'}
        </p>
      </header>

      <div className="jcamp-editor-upload">
        <input
          type="file"
          accept=".jdx,.jcamp,.dx"
          multiple
          onChange={handleFileSelect}
          className="file-input-hidden"
          id="jcamp-file-input"
        />
        <button
          type="button"
          onClick={() => document.getElementById('jcamp-file-input')?.click()}
          className="primary"
        >
          {isBatchMode ? 'Upload JCAMP-DX files (replace)' : 'Upload JCAMP-DX file(s)'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {applyMessage && <div className="jcamp-apply-message">{applyMessage}</div>}

      {isBatchMode && hasData && (
        <div className="jcamp-mode-tabs">
          <button
            type="button"
            className={`jcamp-mode-tab ${editMode === 'group' ? 'active' : ''}`}
            onClick={() => setEditMode('group')}
          >
            Group edit
          </button>
          <button
            type="button"
            className={`jcamp-mode-tab ${editMode === 'individual' ? 'active' : ''}`}
            onClick={() => setEditMode('individual')}
          >
            Individual edit
          </button>
          <div className="jcamp-file-selector">
            {editMode === 'individual' && (
              <select
                value={currentFileIndex}
                onChange={(e) => setCurrentFileIndex(Number(e.target.value))}
                aria-label="Select file"
              >
                {files.map((f, i) => (
                  <option key={f.id} value={i}>
                    {f.fileName}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {hasData && (
        <div className="jcamp-editor-workspace">
          <div className="jcamp-metadata-section">
            <h2>
              {editMode === 'group' && isBatchMode
                ? 'Metadata (applies to all)'
                : `Metadata${currentFile ? ` — ${currentFile.fileName}` : ''}`}
            </h2>

            {editMode === 'group' && isBatchMode ? (
              <div className="jcamp-entries">
                {GROUP_EDIT_KEYS.map((key) => (
                  <div key={key} className="jcamp-entry">
                    <label className="jcamp-entry-key" title={getFormatGuide(key) ?? undefined}>
                      ##{key}=
                    </label>
                    <input
                      type="text"
                      value={getGroupEditValue(key)}
                      onChange={(e) => setGroupEdit(key, e.target.value)}
                      className="jcamp-entry-value"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <>
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
              </>
            )}
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
            <p className="jcamp-data-hint">
              Spectral data is preserved as-is. Only metadata above is editable.
              {editMode === 'group' && isBatchMode && ' Switch to Individual edit to see data.'}
            </p>
          </div>
        </div>
      )}

      {hasData && (
        <div className="jcamp-editor-footer">
          {(editMode === 'group' && isBatchMode) || editMode === 'individual' || !isBatchMode ? (
            <button
              type="button"
              onClick={editMode === 'group' && isBatchMode ? handleApplyGroupEdits : handleApplyIndividual}
              className="primary"
            >
              {editMode === 'group' && isBatchMode ? 'Apply to all files' : 'Apply'}
            </button>
          ) : null}
          <button type="button" onClick={handleDownload} className="primary">
            {isBatchMode ? 'Download all' : 'Download edited file'}
          </button>
          <button
            type="button"
            onClick={handleDecodeAndDownload}
            className="secondary"
            title={
              isLikelyCompressed
                ? 'Convert compressed ASDF/SQZ/DIF data to readable AFFN format'
                : 'Convert to readable format (may already be readable)'
            }
          >
            Decode & download
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="ghost"
            title="Clear all uploaded files"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}
