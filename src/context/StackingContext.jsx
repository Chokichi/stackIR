import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'bkg-remover-spectra'
const OVERLAYS_STORAGE_KEY = 'bkg-remover-molecule-overlays'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data?.spectra?.length) return null
    const spectra = data.spectra
    const validIds = new Set(spectra.map((s) => s.id))
    const visibleIds = new Set((data.visibleIds || []).filter((id) => validIds.has(id)))
    return { spectra, visibleIds }
  } catch {
    return null
  }
}

function saveToStorage(spectra, visibleIds) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        spectra,
        visibleIds: [...visibleIds],
      })
    )
  } catch {
    // ignore quota / privacy errors
  }
}

function loadOverlaysFromStorage() {
  try {
    const raw = localStorage.getItem(OVERLAYS_STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data
  } catch {
    return []
  }
}

function saveOverlaysToStorage(overlays) {
  try {
    localStorage.setItem(OVERLAYS_STORAGE_KEY, JSON.stringify(overlays))
  } catch {
    // ignore
  }
}

const StackingContext = createContext(null)

export function StackingProvider({ children }) {
  const [spectra, setSpectra] = useState([])
  const [visibleIds, setVisibleIds] = useState(new Set())
  const [archivedSpectra, setArchivedSpectra] = useState([])
  const [moleculeOverlays, setMoleculeOverlays] = useState([])

  useEffect(() => {
    const loaded = loadFromStorage()
    if (loaded) {
      setSpectra(loaded.spectra)
      setVisibleIds(loaded.visibleIds)
    }
    const storedOverlays = loadOverlaysFromStorage()
    if (storedOverlays.length) setMoleculeOverlays(storedOverlays)
  }, [])

  useEffect(() => {
    if (spectra.length === 0) return
    saveToStorage(spectra, visibleIds)
  }, [spectra, visibleIds])

  useEffect(() => {
    saveOverlaysToStorage(moleculeOverlays)
  }, [moleculeOverlays])
  const [overlayMode, setOverlayMode] = useState('stacked')
  const [distributedGap, setDistributedGap] = useState(40)
  const [calibrationBgColor, setCalibrationBgColor] = useState('#ffffff')

  const addSpectrum = useCallback(({ dataUrl, data, fileName, ...rest }) => {
    const id = crypto.randomUUID()
    setSpectra((prev) => [...prev, { id, dataUrl, data, fileName, ...rest }])
    setVisibleIds((prev) => new Set([...prev, id]))
    return id
  }, [])

  const addSpectra = useCallback((items) => {
    const newOnes = items.map(({ dataUrl, fileName }) => ({
      id: crypto.randomUUID(),
      dataUrl,
      fileName,
    }))
    setSpectra((prev) => [...prev, ...newOnes])
    setVisibleIds((prev) => new Set([...prev, ...newOnes.map((s) => s.id)]))
  }, [])

  const removeSpectrum = useCallback((id) => {
    setSpectra((prev) => prev.filter((s) => s.id !== id))
    setVisibleIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const archiveSpectrum = useCallback((id) => {
    const spec = spectra.find((s) => s.id === id)
    if (!spec) return
    setSpectra((prev) => prev.filter((s) => s.id !== id))
    setVisibleIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setArchivedSpectra((prev) => [...prev, spec])
  }, [spectra])

  const restoreSpectrum = useCallback((spec) => {
    setArchivedSpectra((prev) => prev.filter((s) => s.id !== spec.id))
    setSpectra((prev) => [...prev, spec])
    setVisibleIds((prev) => new Set([...prev, spec.id]))
  }, [])

  const updateArchivedSpectrum = useCallback((id, updates) => {
    setArchivedSpectra((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    )
  }, [])

  const toggleVisible = useCallback((id) => {
    setVisibleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const updateSpectrum = useCallback((id, updates) => {
    setSpectra((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    )
  }, [])

  const clearSpectra = useCallback(() => {
    setSpectra([])
    setVisibleIds(new Set())
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  const addMoleculeOverlay = useCallback((overlay) => {
    const id = overlay.id ?? crypto.randomUUID()
    const full = {
      id,
      molfile: '',
      svg: '',
      xFrac: 0.65,
      yFrac: 0.08,
      widthFrac: 0.28,
      heightFrac: 0.35,
      ...overlay,
    }
    setMoleculeOverlays((prev) => [...prev, full])
    return id
  }, [])

  const updateMoleculeOverlay = useCallback((id, updates) => {
    setMoleculeOverlays((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...updates } : o))
    )
  }, [])

  const removeMoleculeOverlay = useCallback((id) => {
    setMoleculeOverlays((prev) => prev.filter((o) => o.id !== id))
  }, [])

  const clearMoleculeOverlays = useCallback(() => {
    setMoleculeOverlays([])
  }, [])

  const value = {
    spectra,
    visibleIds,
    archivedSpectra,
    overlayMode,
    setOverlayMode,
    distributedGap,
    setDistributedGap,
    calibrationBgColor,
    setCalibrationBgColor,
    addSpectrum,
    addSpectra,
    removeSpectrum,
    archiveSpectrum,
    restoreSpectrum,
    updateArchivedSpectrum,
    toggleVisible,
    updateSpectrum,
    clearSpectra,
    moleculeOverlays,
    addMoleculeOverlay,
    updateMoleculeOverlay,
    removeMoleculeOverlay,
    clearMoleculeOverlays,
  }

  return (
    <StackingContext.Provider value={value}>{children}</StackingContext.Provider>
  )
}

export function useStacking() {
  const ctx = useContext(StackingContext)
  if (!ctx) throw new Error('useStacking must be used within StackingProvider')
  return ctx
}
