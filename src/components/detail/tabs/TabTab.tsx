import { useState, useCallback } from 'react'
import TabAgentModal from '../TabAgentModal'
import type { Project, TabPart, Instrument } from '../../../types'

const STARTER: Record<Instrument, string> = {
  guitar: 'e|------------------|\nB|------------------|\nG|------------------|\nD|------------------|\nA|------------------|\nE|------------------|',
  bass:   'G|------------------|\nD|------------------|\nA|------------------|\nE|------------------|',
  drums:  'BD|--x---x---x---x--|\nSN|---------x-------|\nHH|x-x-x-x-x-x-x-x--|',
}

const INST_HINT: Record<Instrument, string> = {
  guitar: 'Fret number on string  ·  h hammer-on  ·  / slide  ·  b bend  ·  ~ vibrato',
  bass:   'Fret number on string  ·  h hammer-on  ·  / slide  ·  b bend',
  drums:  'x hit  ·  o ghost  ·  X accent  ·  Rows: BD bass drum  SN snare  HH hi-hat  OH open hi-hat  CY cymbal',
}

function parseParts(raw: string | null): TabPart[] {
  try { return JSON.parse(raw ?? '[]') } catch { return [] }
}

function makeNew(instrument: Instrument, existing: TabPart[]): TabPart {
  const count = existing.filter(p => p.instrument === instrument).length
  const base = { guitar: 'Guitar', bass: 'Bass', drums: 'Drums' }[instrument]
  return {
    id: crypto.randomUUID(),
    name: count > 0 ? `${base} ${count + 1}` : base,
    instrument,
    content: STARTER[instrument],
  }
}

interface Props {
  project: Project
  onUpdate: (field: string, value: unknown) => void
}

export default function TabTab({ project: p, onUpdate }: Props) {
  const [parts, setParts]       = useState<TabPart[]>(() => parseParts(p.tabs))
  const [activeId, setActiveId] = useState<string | null>(() => parseParts(p.tabs)[0]?.id ?? null)
  const [editing, setEditing]   = useState(false)
  const [adding, setAdding]     = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)

  const active = parts.find(pt => pt.id === activeId) ?? null

  const persist = useCallback((updated: TabPart[]) => {
    onUpdate('tabs', JSON.stringify(updated))
  }, [onUpdate])

  const handleInsertGenerated = useCallback((generated: TabPart[]) => {
    const updated = [...parts, ...generated]
    setParts(updated)
    setActiveId(generated[0]?.id ?? activeId)
    persist(updated)
  }, [parts, activeId, persist])

  const addPart = (instrument: Instrument) => {
    const part = makeNew(instrument, parts)
    const updated = [...parts, part]
    setParts(updated)
    setActiveId(part.id)
    setAdding(false)
    setEditing(true)
    persist(updated)
  }

  const updateActive = (changes: Partial<TabPart>) => {
    if (!active) return
    const updated = parts.map(pt => pt.id === active.id ? { ...pt, ...changes } : pt)
    setParts(updated)
    persist(updated)
  }

  const deletePart = (id: string) => {
    const updated = parts.filter(pt => pt.id !== id)
    setParts(updated)
    setActiveId(updated[0]?.id ?? null)
    setEditing(false)
    persist(updated)
  }

  if (parts.length === 0) {
    return (
      <>
        <div className="tab-editor">
          <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '28px 16px 12px', fontSize: 12 }}>
            No tablature yet — add a part manually or let the AI generate a structure.
          </div>
          <div className="tab-add-row">
            <button className="tb-btn primary" onClick={() => setAgentOpen(true)}>
              ✦ Generate with AI
            </button>
          </div>
          <div className="tab-add-row" style={{ paddingTop: 0 }}>
            {(['guitar', 'bass', 'drums'] as Instrument[]).map(inst => (
              <button key={inst} className="tb-btn" onClick={() => addPart(inst)}>
                + {inst.charAt(0).toUpperCase() + inst.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {agentOpen && (
          <TabAgentModal
            project={p}
            onInsert={handleInsertGenerated}
            onClose={() => setAgentOpen(false)}
          />
        )}
      </>
    )
  }

  return (
    <>
    <div className="tab-editor">
      {/* Parts bar */}
      <div className="tab-parts-bar">
        {parts.map(pt => (
          <button
            key={pt.id}
            className={`tab-part-btn ${pt.id === activeId ? 'active' : ''}`}
            onClick={() => { setActiveId(pt.id); setEditing(false); setAdding(false) }}
          >
            {pt.name}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {adding ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {(['guitar', 'bass', 'drums'] as Instrument[]).map(inst => (
              <button key={inst} className="tb-btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => addPart(inst)}>
                {inst.charAt(0).toUpperCase() + inst.slice(1)}
              </button>
            ))}
            <button style={{ fontSize: 11, color: 'var(--text-3)', padding: '2px 6px' }} onClick={() => setAdding(false)}>✕</button>
          </div>
        ) : (
          <>
            <button className="tab-part-btn" onClick={() => setAdding(true)}>+ Part</button>
            <button className="tab-part-btn" style={{ color: 'var(--accent)' }} onClick={() => setAgentOpen(true)}>✦ AI</button>
          </>
        )}
      </div>

      {active && (
        <>
          {/* Part header */}
          <div className="tab-part-header">
            {editing ? (
              <>
                {(['guitar', 'bass', 'drums'] as Instrument[]).map(inst => (
                  <button
                    key={inst}
                    className={`tb-btn ${active.instrument === inst ? 'active-inst' : ''}`}
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => updateActive({ instrument: inst })}
                  >
                    {inst.charAt(0).toUpperCase() + inst.slice(1)}
                  </button>
                ))}
                <input
                  className="tab-name-input"
                  value={active.name}
                  onChange={e => updateActive({ name: e.target.value })}
                  placeholder="Part name"
                />
                <button style={{ fontSize: 11, color: 'var(--red)' }} onClick={() => deletePart(active.id)}>Delete</button>
                <button style={{ fontSize: 11, color: 'var(--accent)' }} onClick={() => setEditing(false)}>Done</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {active.instrument}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-0)' }}>{active.name}</span>
                <div style={{ flex: 1 }} />
                <button style={{ fontSize: 11, color: 'var(--accent)' }} onClick={() => setEditing(true)}>✎ Edit</button>
              </>
            )}
          </div>

          {/* Content */}
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <textarea
                className="tab-content-edit"
                value={active.content}
                onChange={e => updateActive({ content: e.target.value })}
                spellCheck={false}
              />
              <div className="tab-hint">{INST_HINT[active.instrument]}</div>
            </div>
          ) : (
            <pre className="tab-content-view">
              {active.content || <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>(empty — click ✎ Edit to add content)</span>}
            </pre>
          )}
        </>
      )}
    </div>
    {agentOpen && (
      <TabAgentModal
        project={p}
        onInsert={handleInsertGenerated}
        onClose={() => setAgentOpen(false)}
      />
    )}
    </>
  )
}
