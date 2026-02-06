import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { StackingProvider } from './context/StackingContext'
import { BackgroundRemoverProvider } from './context/BackgroundRemoverContext'
import BackgroundRemover from './pages/BackgroundRemover'
import StackingView from './pages/StackingView'
import './App.css'

export default function App() {
  return (
    <StackingProvider>
      <BackgroundRemoverProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<BackgroundRemover />} />
            <Route path="/stacking" element={<StackingView />} />
          </Routes>
        </BrowserRouter>
      </BackgroundRemoverProvider>
    </StackingProvider>
  )
}
