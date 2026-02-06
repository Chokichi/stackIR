import { createContext, useContext, useState, useCallback } from 'react'

const BackgroundRemoverContext = createContext(null)

export function BackgroundRemoverProvider({ children }) {
  const [files, setFiles] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [image, setImage] = useState(null)
  const [imageUrl, setImageUrl] = useState(null)
  const [processedUrl, setProcessedUrl] = useState(null)
  const [targetColor, setTargetColor] = useState('#ffffff')
  const [tolerance, setTolerance] = useState(15)
  const [smoothness, setSmoothness] = useState(0)
  const [liveUpdate, setLiveUpdate] = useState(false)
  const [checkerboardOn, setCheckerboardOn] = useState(true)
  const [previewBgColor, setPreviewBgColor] = useState('#ffffff')
  const [error, setError] = useState('')

  const handleClear = useCallback(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setFiles([])
    setCurrentIndex(0)
    setImage(null)
    setImageUrl(null)
    setProcessedUrl(null)
    setTargetColor('#ffffff')
  }, [imageUrl])

  const value = {
    files,
    setFiles,
    currentIndex,
    setCurrentIndex,
    image,
    setImage,
    imageUrl,
    setImageUrl,
    processedUrl,
    setProcessedUrl,
    targetColor,
    setTargetColor,
    tolerance,
    setTolerance,
    smoothness,
    setSmoothness,
    liveUpdate,
    setLiveUpdate,
    checkerboardOn,
    setCheckerboardOn,
    previewBgColor,
    setPreviewBgColor,
    error,
    setError,
    handleClear,
  }

  return (
    <BackgroundRemoverContext.Provider value={value}>
      {children}
    </BackgroundRemoverContext.Provider>
  )
}

export function useBackgroundRemover() {
  const ctx = useContext(BackgroundRemoverContext)
  if (!ctx) throw new Error('useBackgroundRemover must be used within BackgroundRemoverProvider')
  return ctx
}
