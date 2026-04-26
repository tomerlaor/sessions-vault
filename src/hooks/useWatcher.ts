import { useEffect } from 'react'
import { getWatchedFolders } from '../db/queries/folders'
import { startWatcher } from '../lib/watcher'

export function useWatcher(onUpdate: () => void) {
  useEffect(() => {
    let unlisten: (() => void) | null = null

    async function init() {
      const folders = await getWatchedFolders()
      if (folders.length === 0) return
      unlisten = await startWatcher(folders.map(f => f.path), onUpdate)
    }

    init()
    return () => { unlisten?.() }
  }, [onUpdate])
}
