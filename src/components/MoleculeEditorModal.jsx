import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor } from 'ketcher-react'
import { StandaloneStructServiceProvider } from 'ketcher-standalone'
import { KetcherLogger } from 'ketcher-core'
import 'ketcher-react/dist/index.css'
import './MoleculeEditorModal.css'

// Ketcher's runAsyncAction swallows errors (it logs via KetcherLogger.error
// and emits FAILURE with no payload). Enable the logger so parse errors
// surface in the console instead of being silently eaten.
try {
  KetcherLogger.settings = { enabled: true, showTrace: true, level: 0 /* ERROR */ }
} catch {/* ignore – defensive in case the API changes */}

// Keep the Indigo/WASM structure-service provider alive across modal mounts.
// Re-creating it per-mount causes the first setMolecule on a remount to race
// with the newly-initializing worker (and Ketcher's previous-instance async
// cleanup), producing a FAILURE on attempt 1 and a "data-only" load on
// attempt 2 where the Render subsystem is in a stale state.
let sharedStructServiceProvider = null
function getStructServiceProvider() {
  if (!sharedStructServiceProvider) {
    sharedStructServiceProvider = new StandaloneStructServiceProvider()
  }
  return sharedStructServiceProvider
}

export default function MoleculeEditorModal({
  initialMolfile = '',
  initialLabel = '',
  onSave,
  onClose,
}) {
  const ketcherRef = useRef(null)
  const providerRef = useRef(null)
  if (!providerRef.current) {
    providerRef.current = getStructServiceProvider()
    console.log('[MoleculeEditor] mount: using shared StandaloneStructServiceProvider', {
      initialMolfileLen: (initialMolfile ?? '').length,
      initialLabel,
      providerIsReused: sharedStructServiceProvider === providerRef.current,
    })
  }
  const [ready, setReady] = useState(false)
  // Incremented each time `onInit` fires (React 18 dev / StrictMode double-
  // mounts the Ketcher <Editor>, so we can get a second Ketcher instance
  // after the first onInit. We must re-run the load effect when that happens
  // and target the freshest Ketcher, otherwise setMolecule lands on the
  // orphaned first instance and the visible canvas stays blank.
  const [ketcherEpoch, setKetcherEpoch] = useState(0)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  const [loadingExisting, setLoadingExisting] = useState(Boolean(initialMolfile))
  const [label, setLabel] = useState(initialLabel)

  useEffect(() => {
    console.log('[MoleculeEditor] component mounted')
    return () => console.log('[MoleculeEditor] component unmounted')
  }, [])

  // Stable callbacks so <Editor>'s internal effect doesn't see them change
  // across parent re-renders and trigger extra remounts.
  const stableErrorHandler = useCallback((message) => {
    console.error('Ketcher error:', message)
    setErrorMsg(typeof message === 'string' ? message : 'Molecule editor error.')
  }, [])
  const stableOnInit = useCallback((ketcher) => {
    console.log('[MoleculeEditor] onInit fired', {
      id: ketcher?.id,
      hasEditor: !!ketcher?.editor,
      hasStructService: !!ketcher?.structService,
      hasGetMolfile: typeof ketcher?.getMolfile === 'function',
      hasSetMolecule: typeof ketcher?.setMolecule === 'function',
      prevKetcherId: ketcherRef.current?.id ?? null,
    })
    ketcherRef.current = ketcher
    setReady(true)
    // Bump epoch so the load effect re-runs against the newest Ketcher.
    setKetcherEpoch((n) => n + 1)
  }, [])

  useEffect(() => {
    const log = (...args) => console.log('[MoleculeEditor]', ...args)
    const warn = (...args) => console.warn('[MoleculeEditor]', ...args)
    const err = (...args) => console.error('[MoleculeEditor]', ...args)

    log('useEffect fired', { ready, ketcherEpoch, hasKetcher: !!ketcherRef.current, initialMolfileLen: (initialMolfile ?? '').length })
    if (!ready) return
    // Snapshot the *current* Ketcher, not via the closure. The ref can be
    // swapped under us if Ketcher's Editor remounts (StrictMode) after this
    // effect started. Always read ketcherRef.current lazily inside tryLoad.
    const getK = () => ketcherRef.current
    const k0 = getK()
    if (!k0) {
      warn('ready=true but ketcherRef.current is null; bailing')
      return
    }
    // IMPORTANT: do NOT trim the molfile. MDL V2000 requires 3 header lines
    // before the counts line; the first line is typically blank (a leading
    // "\n"). Trimming strips that blank line, leaving only 2 header lines
    // and causing Indigo to parse the counts line as a comment and fail.
    const raw = initialMolfile ?? ''
    // Only check emptiness via whitespace-stripped length; pass the original.
    if (!raw.replace(/\s+/g, '')) {
      log('no initialMolfile; skipping load')
      setLoadingExisting(false)
      return
    }
    const mol = raw

    log('Ketcher instance details', {
      id: k0?.id,
      hasEditor: !!k0?.editor,
      hasStructService: !!k0?.structService,
      hasEventBus: !!k0?.eventBus,
      editorKeys: k0?.editor ? Object.keys(k0.editor).slice(0, 10) : null,
    })
    log('Molfile preview (first 400 chars):', mol.slice(0, 400))
    log('Molfile total length:', mol.length)

    // Subscribe to Ketcher's internal async-action event bus so we can see the
    // errors that runAsyncAction swallows. Wire this against whatever the
    // latest Ketcher is each attempt (see tryLoad); the subscription below
    // is a best-effort for the initial instance.
    let busCleanup = null
    const wireBus = (inst) => {
      try {
        const bus = inst?.eventBus
        if (bus && typeof bus.on === 'function') {
          const onLoading = () => log('eventBus: LOADING', `id=${inst?.id}`)
          const onSuccess = () => log('eventBus: SUCCESS', `id=${inst?.id}`)
          const onFailure = () => err('eventBus: FAILURE', `id=${inst?.id}`)
          bus.on('LOADING', onLoading)
          bus.on('SUCCESS', onSuccess)
          bus.on('FAILURE', onFailure)
          return () => {
            try {
              bus.off?.('LOADING', onLoading)
              bus.off?.('SUCCESS', onSuccess)
              bus.off?.('FAILURE', onFailure)
            } catch {/* ignore */}
          }
        }
      } catch (e) {
        warn('failed to wire up eventBus listeners', e)
      }
      return null
    }
    busCleanup = wireBus(k0)

    let cancelled = false
    let attempts = 0
    const maxAttempts = 20
    const baseDelayMs = 120
    let lastWiredKetcher = k0

    const snapshotEditor = (inst) => {
      const k = inst ?? getK()
      try {
        const editor = k?.editor
        if (!editor) return { hasEditor: false, ketcherId: k?.id ?? null }
        const hasStructFn = typeof editor.struct === 'function'
        const render = editor.render
        const hasRender = !!render
        const ctab = render?.ctab
        const hasRenderCtab = !!ctab
        let atomSize = null, bondSize = null, fragCount = null
        if (hasStructFn) {
          try {
            const s = editor.struct()
            atomSize = s?.atoms?.size ?? null
            bondSize = s?.bonds?.size ?? null
            fragCount = s?.frags?.size ?? null
          } catch (e) {
            return { hasEditor: true, hasStructFn, hasRender, hasRenderCtab, structThrew: String(e) }
          }
        }
        // Inspect the actual render subsystem: does its ReStruct have any
        // visible atoms/bonds? A data-only success (struct set but render
        // stale) shows atomSize > 0 but ctabAtoms === 0.
        const ctabAtoms = ctab?.atoms?.size ?? null
        const ctabBonds = ctab?.bonds?.size ?? null
        const svgRoot = render?.clientArea?.node?.ownerSVGElement || render?.paper?.canvas
        const svgChildCount = svgRoot?.childNodes?.length ?? null
        return {
          hasEditor: true,
          hasStructFn,
          hasRender,
          hasRenderCtab,
          atomSize,
          bondSize,
          fragCount,
          ctabAtoms,
          ctabBonds,
          svgChildCount,
        }
      } catch (e) {
        return { snapshotThrew: String(e) }
      }
    }

    // Ketcher's setMolecule internally calls zoomAccordingContent / centerStruct
    // after the struct is set. On a remount those helpers can throw because
    // the render's clientArea has no layout yet (0×0 SVG). That throw emits
    // FAILURE even though the struct was placed, and it can leave the canvas
    // un-repainted. So we need to wait until the canvas actually has non-zero
    // dimensions before the first setMolecule call.
    const canvasHasLayout = (inst) => {
      try {
        const render = (inst ?? getK())?.editor?.render
        if (!render) return false
        const node =
          render.clientArea?.node ||
          render.clientArea ||
          render.paper?.canvas ||
          null
        if (!node || typeof node.getBoundingClientRect !== 'function') return false
        const r = node.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      } catch {
        return false
      }
    }

    const waitForCanvasLayout = async (maxMs = 1500) => {
      const start = performance.now()
      while (!cancelled && !canvasHasLayout() && performance.now() - start < maxMs) {
        await new Promise((r) => {
          const id = requestAnimationFrame(() => r(null))
          setTimeout(() => { cancelAnimationFrame(id); r(null) }, 80)
        })
      }
      return canvasHasLayout()
    }

    const structHasAtoms = (inst) => {
      try {
        const ed = (inst ?? getK())?.editor
        const s = typeof ed?.struct === 'function' ? ed.struct() : null
        return (s?.atoms?.size ?? 0) > 0
      } catch { return false }
    }

    const tryLoad = async () => {
      if (cancelled) return
      attempts += 1
      const layoutReady = await waitForCanvasLayout()
      if (cancelled) return

      // ALWAYS target the current Ketcher instance, which may have been
      // swapped after the effect started (see ketcherEpoch).
      const k = getK()
      if (!k) {
        warn(`attempt ${attempts} — no Ketcher available, aborting`)
        setErrorMsg('Molecule editor lost its session; please reopen.')
        setLoadingExisting(false)
        return
      }
      if (k !== lastWiredKetcher) {
        log(`attempt ${attempts} — Ketcher instance changed (was id=${lastWiredKetcher?.id}, now id=${k.id}); rewiring eventBus`)
        busCleanup?.()
        busCleanup = wireBus(k)
        lastWiredKetcher = k
      }

      const preSnap = snapshotEditor(k)
      log(`attempt ${attempts}/${maxAttempts} — ketcherId=${k.id} layoutReady=${layoutReady} pre-setMolecule snapshot:`, preSnap)

      let threw = false
      try {
        await k.setMolecule(mol)
      } catch (e) {
        threw = true
        err(`attempt ${attempts} — setMolecule threw`, e)
      }
      if (cancelled) return
      const postSnap = snapshotEditor(k)
      log(`attempt ${attempts} — setMolecule returned. threw=${threw} post-snapshot:`, postSnap)

      const atomsOk = structHasAtoms(k)
      const ctabOk = (postSnap?.ctabAtoms ?? 0) > 0
      if (atomsOk && ctabOk) {
        log(`attempt ${attempts} — SUCCESS (data+render) on ketcherId=${k.id}`)
        setLoadingExisting(false)
        return
      }

      if (attempts >= maxAttempts) {
        err(`exhausted ${maxAttempts} attempts; final snapshot:`, postSnap)
        setErrorMsg('Could not load the saved structure. You can keep editing or redraw it.')
        setLoadingExisting(false)
        return
      }
      const delay = Math.min(700, baseDelayMs * Math.ceil(attempts / 2))
      log(`attempt ${attempts} — not fully painted (atomsOk=${atomsOk} ctabOk=${ctabOk}); retrying in ${delay}ms`)
      setTimeout(tryLoad, delay)
    }
    // Wrap so that any uncaught exception here can't escape the effect and
    // trigger a remount of the Editor component.
    const safeRun = async () => {
      try {
        await tryLoad()
      } catch (e) {
        err('tryLoad threw uncaught', e)
        if (!cancelled) {
          setErrorMsg('Could not load the saved structure. You can keep editing or redraw it.')
          setLoadingExisting(false)
        }
      }
    }
    safeRun()
    return () => {
      log('cleanup: cancelling pending load')
      cancelled = true
      busCleanup?.()
    }
  }, [ready, ketcherEpoch, initialMolfile])

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
      onSave({ molfile, svg: svgText, label: label.trim() })
    } catch (err) {
      console.error(err)
      setErrorMsg('Failed to save molecule. Try again.')
    } finally {
      setSaving(false)
    }
  }, [onSave, label])

  const isEditing = Boolean((initialMolfile ?? '').trim())

  return (
    <div className="modal-overlay molecule-modal-overlay" onClick={onClose}>
      <div className="molecule-modal" onClick={(e) => e.stopPropagation()}>
        <div className="molecule-modal-header">
          <h3>{isEditing ? 'Edit structure' : 'Insert structure'}</h3>
          <button type="button" className="ghost small" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="molecule-modal-body">
          {(!ready || loadingExisting) && (
            <div className="molecule-modal-loading">
              {loadingExisting ? 'Loading saved structure…' : 'Loading molecule editor…'}
            </div>
          )}
          <Editor
            staticResourcesUrl=""
            structServiceProvider={providerRef.current}
            errorHandler={stableErrorHandler}
            onInit={stableOnInit}
          />
        </div>
        {errorMsg && <div className="molecule-modal-error">{errorMsg}</div>}
        <div className="molecule-modal-footer">
          <label className="molecule-modal-label-field">
            <span>Label (optional)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. acetone"
              maxLength={120}
            />
          </label>
          <div className="molecule-modal-footer-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="primary"
              onClick={handleSave}
              disabled={!ready || saving}
            >
              {saving ? 'Saving…' : (isEditing ? 'Update' : 'Insert')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
