import { useState, useCallback, useMemo, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { AboutWindow } from './components/AboutWindow'
import Sidebar from './components/layout/Sidebar'
import ProjectList from './components/library/ProjectList'
import DetailPanel from './components/detail/DetailPanel'
import Icon from './components/shared/Icon'
import SettingsModal from './components/settings/SettingsModal'
import { useProjects, useFilteredProjects } from './hooks/useProjects'
import { useScanner } from './hooks/useScanner'
import { useWatcher } from './hooks/useWatcher'
import { getTags } from './db/queries/tags'
import type { Project, Tag } from './types'
import type { Filter, Sort } from './hooks/useProjects'

export default function App() {
  const { projects, reload } = useProjects()
  const [filter, setFilter] = useState<Filter>({ view: 'all', daw: null, collection: null, tags: [], search: '' })
  const [sort, setSort]     = useState<Sort>({ key: 'modifiedAt', dir: 'desc' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const closeAbout = useCallback(() => setShowAbout(false), [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen('show-about', () => setShowAbout(true)).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }, [])

  const reloadTags = useCallback(() => {
    getTags().then(setAllTags)
  }, [])

  const stableReload = useCallback((count?: number) => {
    reload()
    if (count !== undefined) {
      showToast(count === 0 ? 'No DAW projects found in that folder.' : `Found ${count} project${count === 1 ? '' : 's'}.`)
    }
  }, [reload, showToast])
  const { scanning, error: scanError, pickAndScan } = useScanner(stableReload)

  useEffect(() => {
    if (scanError) showToast(`Scan error: ${scanError}`)
  }, [scanError, showToast])
  useWatcher(stableReload)

  useEffect(() => { reloadTags() }, [reloadTags])

  const filtered = useFilteredProjects(projects, filter, sort)
  const selected = projects.find(p => p.id === selectedId) ?? null

  const counts = useMemo(() => {
    const active = projects.filter(p => p.status !== 'archived')
    const c = { all: active.length, starred: 0, recent: Math.min(active.length, 6), dirty: 0, archived: 0, daw: {} as Record<string,number> }
    projects.forEach(p => {
      if (p.status === 'archived') { c.archived++; return }
      if (p.status === 'draft') c.dirty++
      c.daw[p.daw] = (c.daw[p.daw] ?? 0) + 1
    })
    return c
  }, [projects])

  const viewLabel: Record<string, string> = {
    all: 'All projects', starred: 'Starred', recent: 'Recent', dirty: 'Needs backup', archived: 'Archived'
  }

  const onReveal = async (p: Project) => {
    await invoke('reveal_in_finder', { path: p.filePath })
  }
  const onOpen = async (p: Project) => {
    await invoke('open_in_daw', { path: p.filePath })
    showToast(`Opening ${p.title}…`)
  }

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar">
        <div className="traffic">
          <div className="dot r"/><div className="dot y"/><div className="dot g"/>
        </div>
        <div className="title">
          <Icon name="drive" size={12} style={{ display:'inline-block', verticalAlign:'middle', marginRight:6, color:'var(--accent)' }} />
          <b>Sessions</b> <span style={{ opacity: 0.6 }}>— DAW Project Manager</span>
        </div>
        <div className="search">
          <Icon name="search" size={12} style={{ color: 'var(--text-2)' }} />
          <input placeholder="Search projects, tags…"
            value={filter.search}
            onChange={e => setFilter({ ...filter, search: e.target.value })} />
          <span className="kbd">⌘K</span>
        </div>
        <div className="tb-actions">
          <button className="tb-btn primary" onClick={pickAndScan} disabled={scanning}>
            <Icon name="plus" size={12} /> {scanning ? 'Scanning…' : 'Add folder'}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <Sidebar filter={filter} setFilter={setFilter} counts={counts} allTags={allTags} onOpenSettings={() => setShowSettings(true)} />

      {/* Main */}
      <main className={`main ${showDetail && selected ? '' : 'no-detail'}`}>
        <ProjectList
          projects={filtered}
          selectedId={selectedId}
          sort={sort}
          setSort={setSort}
          label={viewLabel[filter.view] ?? 'All projects'}
          onSelect={id => { setSelectedId(id); setShowDetail(true) }}
          onReveal={onReveal}
          onOpen={onOpen} />

        {showDetail && selected && (
          <DetailPanel
            project={selected}
            allTags={allTags}
            onClose={() => setShowDetail(false)}
            onOpen={onOpen}
            onReveal={onReveal}
            onProjectUpdated={reload}
            onTagChange={() => { reload(); reloadTags() }} />
        )}
      </main>

      {/* Statusbar */}
      <div className="statusbar">
        <span>{filtered.length} of {projects.length} projects</span>
        <span className="sep" />
        <div className="right">
          <span>Watching ~/Music</span>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showAbout && <AboutWindow onClose={closeAbout} />}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-3)', border: '1px solid var(--line-2)',
          padding: '8px 14px', borderRadius: 8, fontSize: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 200 }}>
          {toast}
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && !scanning && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
          background: 'var(--bg-0)', zIndex: 10 }}>
          <Icon name="music" size={48} style={{ color: 'var(--text-3)', opacity: 0.4 }} />
          <div style={{ fontSize: 18, fontWeight: 600 }}>No projects yet</div>
          <div style={{ color: 'var(--text-2)', fontSize: 13 }}>Add a folder to start scanning for DAW projects</div>
          <button className="tb-btn primary" style={{ marginTop: 8 }} onClick={pickAndScan}>
            <Icon name="plus" size={14} /> Add music folder
          </button>
        </div>
      )}
    </div>
  )
}
