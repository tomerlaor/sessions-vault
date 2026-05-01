import Icon from '../shared/Icon'
import WaveArt from '../shared/WaveArt'
import type { Project } from '../../types'

const DAWS: Record<string, { name: string; color: string }> = {
  ableton: { name: 'Ableton Live', color: '#ff7a45' },
  logic:   { name: 'Logic Pro',    color: '#ffcc66' },
  fl:      { name: 'FL Studio',    color: '#5cd18b' },
  bitwig:  { name: 'Bitwig',       color: '#ff5a5a' },
  reaper:  { name: 'Reaper',       color: '#a98bff' },
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Not synced', mixed: 'Partially synced', released: 'Synced', archived: 'Archived',
}

interface ProjectRowProps {
  project: Project
  wave: number[]
  art: string
  selected: boolean
  onClick: () => void
  onReveal: () => void
  onOpen: () => void
  onStar: () => void
}

export default function ProjectRow({ project: p, wave, art, selected, onClick, onReveal, onOpen, onStar }: ProjectRowProps) {
  const starred = p.rating != null && p.rating > 0
  const daw = DAWS[p.daw] ?? { name: p.daw, color: '#888' }
  const modifiedDate = new Date(p.modifiedAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <tr className={selected ? 'selected' : ''} onClick={onClick}>
      <td>
        <div className="name-cell">
          <WaveArt wave={wave} bg={art} size={32} />
          <div className="name">
            <div className="title">{p.title}</div>
            <div className="path" title={p.filePath}>{p.filePath}</div>
          </div>
        </div>
      </td>
      <td>
        <div className="daw-pill" style={{ background: `${daw.color}22`, color: daw.color }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: daw.color, flexShrink: 0 }} />
          {daw.name}
        </div>
      </td>
      <td>
        <div className="sync-cell">
          <span className={`status-dot ${p.status}`} />
          <span>{STATUS_LABEL[p.status] ?? p.status}</span>
        </div>
      </td>
      <td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        {p.bpm ?? '—'} / {p.key ?? '—'}
      </td>
      <td>
        <div className="tags-cell">
          {(p.tags ?? []).slice(0, 3).map(t => <span key={t} className="tag">{t}</span>)}
        </div>
      </td>
      <td style={{ color: 'var(--text-2)', fontSize: 11.5 }}>{modifiedDate}</td>
      <td style={{ color: 'var(--text-2)', fontSize: 11.5, textAlign: 'right' }}>
        {(p.sizeBytes / 1e6).toFixed(0)} MB
      </td>
      <td onClick={e => e.stopPropagation()}>
        <div className="row-actions">
          <button
            className="row-btn"
            title={starred ? 'Unstar' : 'Star'}
            onClick={onStar}
            style={{ color: starred ? '#f5a623' : undefined, opacity: starred ? 1 : undefined }}
          >
            <Icon name="star" size={12} />
          </button>
          <button className="row-btn" title="Open in DAW" onClick={onOpen}><Icon name="open" size={12} /></button>
          <button className="row-btn" title="Reveal in Finder" onClick={onReveal}><Icon name="folder" size={12} /></button>
          <button className="row-btn" title="More"><Icon name="dots" size={12} /></button>
        </div>
      </td>
    </tr>
  )
}
