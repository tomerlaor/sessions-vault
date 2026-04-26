import { useState, useMemo } from 'react'
import type { Project } from '../../../types'

interface Props {
  project: Project
  onUpdate: (field: string, value: unknown) => void
}

// Detect Hebrew / Arabic characters
function detectRtl(text: string) {
  return /[֐-׿؀-ۿ]/.test(text)
}

interface Segment { chord?: string; text: string }

// "[Am]Hello [F]world" → [{chord:'Am', text:'Hello '}, {chord:'F', text:'world'}]
function parseChordLine(line: string): Segment[] {
  const parts = line.split(/(\[[^\]]+\])/)
  const result: Segment[] = []
  let pending: string | undefined

  for (const part of parts) {
    const m = part.match(/^\[([^\]]+)\]$/)
    if (m) {
      if (pending !== undefined) result.push({ chord: pending, text: '' })
      pending = m[1]
    } else {
      result.push({ chord: pending, text: part })
      pending = undefined
    }
  }
  if (pending !== undefined) result.push({ chord: pending, text: '' })
  return result
}

function ChordRow({ line, rtl }: { line: string; rtl: boolean }) {
  const segments = parseChordLine(line)
  const hasChords = segments.some(s => s.chord)

  if (!hasChords) {
    return <p style={{ margin: '0 0 2px', color: 'var(--text-0)' }}>{line || ' '}</p>
  }

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end',
      marginBottom: 10, direction: rtl ? 'rtl' : 'ltr',
    }}>
      {segments.map((seg, i) => (
        <span key={i} style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{
            fontSize: 11, fontWeight: 700, lineHeight: '16px',
            color: '#7c9fff', minHeight: '16px',
            paddingRight: seg.text ? 2 : 0,
          }}>
            {seg.chord ?? ''}
          </span>
          <span style={{ fontSize: 13, lineHeight: '22px', color: 'var(--text-0)', whiteSpace: 'pre' }}>
            {seg.text || (seg.chord ? '  ' : '')}
          </span>
        </span>
      ))}
    </div>
  )
}

function LyricsView({ text, rtl }: { text: string; rtl: boolean }) {
  const lines = text.split('\n')

  return (
    <div className="lyrics-content" style={{ direction: rtl ? 'rtl' : 'ltr' }}>
      {lines.map((line, i) => {
        const trimmed = line.trim()

        // [Section Name] — whole line is a section header
        if (/^\[[^\]]+\]$/.test(trimmed) && !trimmed.slice(1, -1).match(/^[A-G][b#]?(m|maj|min|dim|aug|sus|add|M)?[0-9]*/)) {
          return (
            <div key={i} className="section">
              {trimmed.slice(1, -1)}
            </div>
          )
        }

        // (Remark) — whole line is a remark
        if (/^\(.+\)$/.test(trimmed)) {
          return (
            <div key={i} style={{
              fontSize: 11, fontStyle: 'italic', color: 'var(--text-3)',
              margin: '4px 0', userSelect: 'none',
            }}>
              {trimmed}
            </div>
          )
        }

        // Line with inline chords or plain text
        return <ChordRow key={i} line={line} rtl={rtl} />
      })}
    </div>
  )
}

export default function LyricsTab({ project: p, onUpdate }: Props) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState('')
  const [rtlOverride, setRtlOverride] = useState<boolean | null>(null)

  const text = p.lyrics ?? ''
  const autoRtl = useMemo(() => detectRtl(text || draft), [text, draft])
  const rtl = rtlOverride !== null ? rtlOverride : autoRtl

  const startEdit = () => {
    setDraft(text)
    setEditing(true)
  }

  const handleDone = async () => {
    await onUpdate('lyrics', draft)
    setEditing(false)
  }

  return (
    <div className="lyrics-editor">
      <div className="lyrics-toolbar">
        {p.key  && <button title="Key">{p.key}</button>}
        {p.bpm  && <button title="BPM">{p.bpm} BPM</button>}
        <div style={{ flex: 1 }} />
        <button
          title={rtl ? 'Switch to LTR' : 'Switch to RTL'}
          onClick={() => setRtlOverride(r => r === null ? !autoRtl : !r)}
          style={{ fontFamily: 'serif', fontSize: 13, opacity: rtl ? 1 : 0.45 }}>
          ←A
        </button>
        <button style={{ color: 'var(--accent)' }} onClick={editing ? handleDone : startEdit}>
          {editing ? 'Done' : '✎ Edit'}
        </button>
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <textarea
            className="description-input"
            dir={rtl ? 'rtl' : 'ltr'}
            style={{
              border: 'none', borderRadius: 0, minHeight: 240,
              background: 'var(--bg-0)', textAlign: rtl ? 'right' : 'left',
            }}
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div style={{
            padding: '6px 12px', fontSize: 10, color: 'var(--text-3)',
            borderTop: '1px solid var(--line)', background: 'var(--bg-1)',
            lineHeight: 1.8,
          }}>
            <b style={{ color: 'var(--text-2)' }}>[Am]</b> chord above word
            &nbsp;&nbsp;·&nbsp;&nbsp;
            <b style={{ color: 'var(--text-2)' }}>[Chorus]</b> section header (whole line)
            &nbsp;&nbsp;·&nbsp;&nbsp;
            <b style={{ color: 'var(--text-2)' }}>(remark)</b> italic note
          </div>
        </div>
      ) : text ? (
        <LyricsView text={text} rtl={rtl} />
      ) : (
        <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 32, fontSize: 12 }}>
          No lyrics yet — click ✎ Edit to add.
        </div>
      )}
    </div>
  )
}
