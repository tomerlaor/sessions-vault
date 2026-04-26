import { useState, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { scanFolder } from '../lib/scanner'

export function useScanner(onComplete: (count: number) => void) {
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ scanned: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pickAndScan = useCallback(async () => {
    console.log('[scanner] opening dialog')
    const selected = await open({ directory: true, multiple: false, title: 'Select music folder' })
    console.log('[scanner] dialog returned:', selected, typeof selected)
    if (!selected) { console.log('[scanner] nothing selected'); return }
    const path = typeof selected === 'string' ? selected : (selected as { path: string }).path
    console.log('[scanner] path:', path)
    if (!path) { console.log('[scanner] path empty'); return }
    setScanning(true)
    setProgress(null)
    setError(null)
    try {
      console.log('[scanner] invoking scan_folder...')
      const count = await scanFolder(path, p => setProgress({ scanned: p.scanned, total: p.total }))
      console.log('[scanner] scan done, count:', count)
      onComplete(count)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      console.error('[scanner] scan failed:', e)
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }, [onComplete])

  return { scanning, progress, error, pickAndScan }
}
