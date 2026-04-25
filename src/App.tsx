import { useEffect, useState, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { AboutWindow } from './components/AboutWindow'
import './App.css'

function App() {
  const [showAbout, setShowAbout] = useState(false)
  const closeAbout = useCallback(() => setShowAbout(false), [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen('show-about', () => setShowAbout(true)).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  return (
    <div className="min-h-screen bg-[#111111] flex items-center justify-center">
      <p className="text-[#333333] text-sm tracking-widest uppercase">
        SessionsVault — coming soon
      </p>
      {showAbout && <AboutWindow onClose={closeAbout} />}
    </div>
  )
}

export default App
