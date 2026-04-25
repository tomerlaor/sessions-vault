import { useEffect, useState, useCallback } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { open } from '@tauri-apps/plugin-opener'
import './AboutWindow.css'

interface Props {
  onClose: () => void
}

export function AboutWindow({ onClose }: Props) {
  const [version, setVersion] = useState('...')

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion('unknown'))
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="about-overlay" onClick={onClose}>
      <div
        className="about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="about-tracks" aria-hidden="true">
          <div className="about-track" style={{ width: '78%' }} />
          <div className="about-track" style={{ width: '44%' }} />
          <div className="about-track" style={{ width: '63%' }} />
          <div className="about-track" style={{ width: '29%' }} />
          <div className="about-track" style={{ width: '71%' }} />
          <div className="about-track" style={{ width: '50%' }} />
        </div>

        <div className="about-content">
          <svg
            className="about-icon"
            width="48"
            height="65"
            viewBox="0 0 52 70"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="0"  y="0"  width="36" height="8" rx="2" fill="#ff5a00" />
            <rect x="40" y="0"  width="12" height="8" rx="2" fill="#ff5a00" opacity="0.3" />
            <rect x="0"  y="13" width="18" height="8" rx="2" fill="#2a2a2a" />
            <rect x="22" y="13" width="30" height="8" rx="2" fill="#2a2a2a" />
            <rect x="0"  y="26" width="26" height="8" rx="2" fill="#ff5a00" opacity="0.6" />
            <rect x="30" y="26" width="22" height="8" rx="2" fill="#2a2a2a" />
            <rect x="0"  y="39" width="12" height="8" rx="2" fill="#2a2a2a" />
            <rect x="16" y="39" width="36" height="8" rx="2" fill="#ff5a00" opacity="0.85" />
            <rect x="0"  y="52" width="22" height="8" rx="2" fill="#ff5a00" opacity="0.35" />
            <rect x="26" y="52" width="26" height="8" rx="2" fill="#2a2a2a" />
          </svg>

          <h1 id="about-title" className="about-name">
            Sessions<span>Vault</span>
          </h1>

          <p className="about-version">v{version} · Apache 2.0</p>

          <div className="about-links">
            <button
              className="about-link"
              onClick={() => open('https://www.apache.org/licenses/LICENSE-2.0').catch(console.error)}
            >
              License ↗
            </button>
            <button
              className="about-link"
              onClick={() => open('https://github.com/tomerlaor/sessions-vault').catch(console.error)}
            >
              GitHub ↗
            </button>
          </div>

          <p className="about-built">Built with Tauri · React · Rust</p>
          <p className="about-copy">© 2026 Tomer Laor. All rights reserved.</p>
        </div>
      </div>
    </div>
  )
}
