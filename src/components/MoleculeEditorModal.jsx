import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from 'ketcher-react'
import { StandaloneStructServiceProvider } from 'ketcher-standalone'
import 'ketcher-react/dist/index.css'
import './MoleculeEditorModal.css'

const structServiceProvider = new StandaloneStructServiceProvider()

export default function MoleculeEditorModal({ initialMolfile = '', onSave, onClose }) {
  const ketcherRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  useEffect(() => {
    if (!ready) return
    const k = ketcherRef.current
    if (!k || !initialMolfile) return
    k.setMolecule(initialMolfile).catch((err) => {
      console.error('Failed to load molecule into Ketcher', err)
    })
  }, [ready, initialMolfile])

  const handleSave = useCallback(async () => {
    const k = ketcherRef.current
    if (!k) return
    setSaving(true)
    setErrorMsg(null)
    try {
      const molfile = await k.getMolfile()
      const trimmed = (molfile ?? '').trim()
      // A valid molfile with any atoms will have at least a header + counts + one atom line.
      const lines = trimmed.split(/\r?\n/).filter(Boolean)
      if (lines.length < 5) {
        setErrorMsg('Draw a structure before saving.')
        setSaving(false)
        return
      }
      let svgText = ''
      try {
        const svgBlob = await k.generateImage(molfile, { outputFormat: 'svg' })
        svgText = await svgBlob.text()
      } catch (err) {
        console.error('Failed to generate SVG for structure', err)
        setErrorMsg('Failed to render structure preview.')
        setSaving(false)
        return
      }
      onSave({ molfile, svg: svgText })
    } catch (err) {
      console.error(err)
      setErrorMsg('Failed to save molecule. Try again.')
    } finally {
      setSaving(false)
    }
  }, [onSave])

  return (
    <div className="modal-overlay molecule-modal-overlay" onClick={onClose}>
      <div className="molecule-modal" onClick={(e) => e.stopPropagation()}>
        <div className="molecule-modal-header">
          <h3>{initialMolfile ? 'Edit structure' : 'Insert structure'}</h3>
          <button type="button" className="ghost small" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="molecule-modal-body">
          {!ready && (
            <div className="molecule-modal-loading">Loading molecule editor…</div>
          )}
          <Editor
            staticResourcesUrl=""
            structServiceProvider={structServiceProvider}
            errorHandler={(message) => {
              console.error('Ketcher error:', message)
              setErrorMsg(typeof message === 'string' ? message : 'Molecule editor error.')
            }}
            onInit={(ketcher) => {
              ketcherRef.current = ketcher
              setReady(true)
            }}
          />
        </div>
        {errorMsg && <div className="molecule-modal-error">{errorMsg}</div>}
        <div className="molecule-modal-footer">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            onClick={handleSave}
            disabled={!ready || saving}
          >
            {saving ? 'Saving…' : (initialMolfile ? 'Update' : 'Insert')}
          </button>
        </div>
      </div>
    </div>
  )
}
