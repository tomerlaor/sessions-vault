import { useState, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import Icon from '../shared/Icon'
import WaveArt, { deterministicWave } from '../shared/WaveArt'
import OverviewTab from './tabs/OverviewTab'
import LyricsTab from './tabs/LyricsTab'
import TabTab from './tabs/TabTab'
import HistoryTab from './tabs/HistoryTab'
import TodoTab from './tabs/TodoTab'
import { updateProjectField, renameProject } from '../../db/queries/projects'
import type { Project, Tag } from '../../types'

const DAWS: Record<string, { name: string; color: string }> = {
  ableton: { name: 'Ableton Live', color: '#ff7a45' },
  logic:   { name: 'Logic Pro',    color: '#ffcc66' },
  fl:      { name: 'FL Studio',    color: '#5cd18b' },
  bitwig:  { name: 'Bitwig',       color: '#ff5a5a' },
  reaper:  { name: 'Reaper',       color: '#a98bff' },
}

const COLORS = [['#6b21a8','#ec4899'],['#f59e0b','#b45309'],['#0ea5e9','#1e3a8a']]
const artFor = (id: string) => {
  const i = id.charCodeAt(0) % COLORS.length
  return `linear-gradient(135deg, ${COLORS[i][0]} 0%, ${COLORS[i][1]} 100%)`
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'music'   },
  { id: 'lyrics',   label: 'Lyrics',   icon: 'section' },
  { id: 'tab',      label: 'Tab',      icon: 'music'   },
  { id: 'history',  label: 'Sync',     icon: 'history' },
  { id: 'todo',     label: 'To-do',    icon: 'check'   },
] as const

type TabId = typeof TABS[number]['id']

interface Props {
  project: Project
  allTags: Tag[]
  onClose: () => void
  onOpen: (p: Project) => void
  onReveal: (p: Project) => void
  onProjectUpdated: () => void
  onTagChange: () => void
}

export default function DetailPanel({ project: p, allTags, onClose, onOpen, onReveal, onProjectUpdated, onTagChange }: Props) {
  const [tab, setTab] = useState<TabId>('overview')
  const [copied, setCopied] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const daw = DAWS[p.daw] ?? { name: p.daw, color: '#888' }

  const copyPath = useCallback(() => {
    navigator.clipboard.writeText(p.filePath)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [p.filePath])

  const startEdit = useCallback(() => {
    setTitleDraft(p.title)
    setRenameError(null)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 0)
  }, [p.title])

  const cancelEdit = useCallback(() => {
    setEditingTitle(false)
    setRenameError(null)
  }, [])

  const commitRename = useCallback(async () => {
    const newName = titleDraft.trim()
    if (!newName || newName === p.title) { cancelEdit(); return }
    setRenameError(null)
    try {
      const newPath = await invoke<string>('rename_project', { oldPath: p.filePath, newName })
      await renameProject(p.id, newName, newPath)
      setEditingTitle(false)
      onProjectUpdated()
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e))
    }
  }, [titleDraft, p.title, p.filePath, p.id, cancelEdit, onProjectUpdated])

  const handleUpdate = async (field: string, value: unknown) => {
    await updateProjectField(p.id, field, value)
    onProjectUpdated()
  }

  return (
    <aside className="detail">
      <div className="detail-header">
        <div className="top">
          <WaveArt wave={deterministicWave(p.id.charCodeAt(0))} bg={artFor(p.id)} size={64} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingTitle ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelEdit() }}
                  onBlur={commitRename}
                  autoFocus
                  style={{ fontSize: 16, fontWeight: 600, background: 'var(--bg-2)',
                    border: '1px solid var(--accent)', borderRadius: 5, padding: '3px 7px',
                    color: 'var(--text-1)', width: '100%', boxSizing: 'border-box' }}
                />
                {renameError && <div style={{ fontSize: 11, color: '#ff5a5a' }}>{renameError}</div>}
              </div>
            ) : (
              <h2
                title="Double-click to rename"
                onDoubleClick={startEdit}
                style={{ cursor: 'text' }}>
                {p.title}
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400,
                  color: 'var(--text-3)', opacity: 0.6 }}>✎</span>
              </h2>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <div className="path" title={p.filePath} style={{ flex: 1, minWidth: 0 }}>{p.filePath}</div>
              <button
                onClick={copyPath}
                title="Copy full path"
                style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
                  color: copied ? 'var(--accent)' : 'var(--text-3)', padding: '2px 4px', fontSize: 10 }}>
                {copied ? '✓' : 'copy'}
              </button>
            </div>
            <div className="meta-row">
              <span>
                <div style={{ width:11,height:11,borderRadius:2,background:daw.color,display:'inline-block',verticalAlign:'middle',marginRight:4 }}/>
                <b>{daw.name}</b>
              </span>
              <span>{(p.sizeBytes/1e6).toFixed(0)} MB</span>
              <span>Modified {new Date(p.modifiedAt*1000).toLocaleDateString()}</span>
            </div>
          </div>
          <button className="detail-close" onClick={onClose}><Icon name="x" size={12} /></button>
        </div>
        <div className="detail-actions">
          <button className="tb-btn primary" onClick={() => onOpen(p)}>
            <Icon name="open" size={12} /> Open in {daw.name}
          </button>
          <button className="tb-btn" onClick={() => onReveal(p)} title="Reveal in Finder">
            <Icon name="folder" size={12} />
          </button>
          {p.status === 'archived' ? (
            <button className="tb-btn" title="Unarchive" onClick={() => handleUpdate('status', 'draft')}>
              <Icon name="archive" size={12} />
              Unarchive
            </button>
          ) : (
            <button className="tb-btn" title="Archive project" onClick={() => handleUpdate('status', 'archived')}>
              <Icon name="archive" size={12} />
              Archive
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab ${tab===t.id?'active':''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon as any} size={11} />{t.label}
          </button>
        ))}
      </div>

      <div className="tab-body">
        {tab === 'overview' && (
          <OverviewTab
            project={p}
            allTags={allTags}
            onUpdate={handleUpdate}
            onTagChange={onTagChange}
          />
        )}
        {tab === 'lyrics'   && <LyricsTab project={p} onUpdate={handleUpdate} />}
        {tab === 'tab'      && <TabTab project={p} onUpdate={handleUpdate} />}
        {tab === 'history'  && <HistoryTab project={p} />}
        {tab === 'todo'     && <TodoTab key={p.id} project={p} onUpdate={handleUpdate} />}
      </div>
    </aside>
  )
}
