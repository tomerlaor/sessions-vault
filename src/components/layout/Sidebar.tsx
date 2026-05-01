import Icon from '../shared/Icon'
import type { Filter } from '../../hooks/useProjects'
import type { Tag } from '../../types'

const DAWS: Record<string, { name: string; color: string }> = {
  ableton: { name: 'Ableton Live', color: '#ff7a45' },
  logic:   { name: 'Logic Pro',    color: '#ffcc66' },
  fl:      { name: 'FL Studio',    color: '#5cd18b' },
  bitwig:  { name: 'Bitwig',       color: '#ff5a5a' },
  reaper:  { name: 'Reaper',       color: '#a98bff' },
}

interface Counts {
  all: number; starred: number; recent: number; dirty: number; archived: number
  daw: Record<string, number>
}

interface SidebarProps {
  filter: Filter
  setFilter: (f: Filter) => void
  counts: Counts
  allTags: Tag[]
  onOpenSettings: () => void
}

export default function Sidebar({ filter, setFilter, counts, allTags, onOpenSettings }: SidebarProps) {
  const setF = (patch: Partial<Filter>) => setFilter({ ...filter, ...patch })

  return (
    <aside className="sidebar">
<div className="sb-section-title">Library</div>
      {([
        { id: 'all',      label: 'All projects', icon: 'music'   },
        { id: 'starred',  label: 'Starred',       icon: 'star'    },
        { id: 'recent',   label: 'Recent',        icon: 'history' },
        { id: 'dirty',    label: 'Needs backup',  icon: 'upload'  },
        { id: 'archived', label: 'Archived',      icon: 'archive' },
      ] as const).map(v => (
        <div key={v.id}
          className={`sb-item ${filter.view === v.id ? 'active' : ''}`}
          onClick={() => setF({ view: v.id, collection: null })}>
          <Icon name={v.icon} size={13} />
          <span>{v.label}</span>
          <span className="count">{counts[v.id]}</span>
        </div>
      ))}

      <div className="sb-divider" />
      <div className="sb-section-title">DAWs</div>
      {Object.entries(DAWS).map(([id, d]) => (
        <div key={id}
          className={`sb-item ${filter.daw === id ? 'active' : ''}`}
          onClick={() => setF({ daw: filter.daw === id ? null : id })}>
          <div className="swatch" style={{ background: d.color }} />
          <span>{d.name}</span>
          <span className="count">{counts.daw[id] || 0}</span>
        </div>
      ))}

      <div className="sb-divider" />
      <div className="sb-section-title">Tags</div>
      {allTags.slice(0, 10).map(t => (
        <div key={t.id}
          className={`sb-item ${filter.tags.includes(t.name) ? 'active' : ''}`}
          onClick={() => {
            const has = filter.tags.includes(t.name)
            setF({ tags: has ? filter.tags.filter(x => x !== t.name) : [...filter.tags, t.name] })
          }}>
          <div className="swatch" style={{ background: t.color }} />
          <span>#{t.name}</span>
        </div>
      ))}

      <div style={{ marginTop: 'auto', padding: '8px 4px 0', borderTop: '1px solid var(--line)' }}>
        <div className="sb-item" onClick={onOpenSettings} style={{ color: 'var(--text-3)' }}>
          <Icon name="settings" size={13} />
          <span>Settings</span>
        </div>
      </div>
    </aside>
  )
}
