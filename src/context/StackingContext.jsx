import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'bkg-remover-spectra'

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

const StackingContext = createContext(null)

export function StackingProvider({ children }) {
  const [spectra, setSpectra] = useState([])
  const [visibleIds, setVisibleIds] = useState(new Set())

  useEffect(() => {
    const loaded = loadFromStorage()
    if (loaded) {
      setSpectra(loaded.spectra)
      setVisibleIds(loaded.visibleIds)
    }
  }, [])

  useEffect(() => {
    if (spectra.length === 0) return
    saveToStorage(spectra, visibleIds)
  }, [spectra, visibleIds])
  const [overlayMode, setOverlayMode] = useState('stacked')
  const [distributedGap, setDistributedGap] = useState(40)
  const [calibrationBgColor, setCalibrationBgColor] = useState('#ffffff')

  const addSpectrum = useCallback(({ dataUrl, fileName }) => {
    const id = crypto.randomUUID()
    setSpectra((prev) => [...prev, { id, dataUrl, fileName }])
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

  const value = {
    spectra,
    visibleIds,
    overlayMode,
    setOverlayMode,
    distributedGap,
    setDistributedGap,
    calibrationBgColor,
    setCalibrationBgColor,
    addSpectrum,
    addSpectra,
    removeSpectrum,
    toggleVisible,
    updateSpectrum,
    clearSpectra,
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
