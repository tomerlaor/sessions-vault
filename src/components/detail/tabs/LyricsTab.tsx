import { useState, useMemo, useRef } from 'react'
import type { Project } from '../../../types'

interface Props {
  project: Project
  onUpdate: (field: string, value: unknown) => void
}

const CHORD_RE = /\[([A-G][b#]?(?:sus[24]?(?:maj|min|m|M)?[0-9]*|(?:maj|min|dim|aug|dom|alt|add|m|M)?[0-9]*)(?:[b#][0-9]+)*(?:\/[A-G][b#]?)?)\]/g

function extractUniqueChords(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(CHORD_RE)) seen.add(m[1])
  return [...seen]
}

function detectRtl(text: string) {
  return /[֐-׿؀-ۿ]/.test(text)
}

interface Segment { chord?: string; text: string }

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
    return <p style={{ margin: '0 0 2px', color: 'var(--text-0)' }}>{line || ' '}</p>
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
            {seg.text || (seg.chord ? '  ' : '')}
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

        if (/^\[[^\]]+\]$/.test(trimmed) && !/^\[([A-G][b#]?(?:sus[24]?(?:maj|min|m|M)?[0-9]*|(?:maj|min|dim|aug|dom|alt|add|m|M)?[0-9]*)(?:[b#][0-9]+)*(?:\/[A-G][b#]?)?)\]$/.test(trimmed)) {
          return (
            <div key={i} className="section">
              {trimmed.slice(1, -1)}
            </div>
          )
        }

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

        return <ChordRow key={i} line={line} rtl={rtl} />
      })}
    </div>
  )
}

export default function LyricsTab({ project: p, onUpdate }: Props) {
  const [editing, setEditing]       = useState(false)
  const [draft, setDraft]           = useState('')
  const [rtlOverride, setRtlOverride] = useState<boolean | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const text = p.lyrics ?? ''
  const autoRtl = useMemo(() => detectRtl(text || draft), [text, draft])
  const rtl = rtlOverride !== null ? rtlOverride : autoRtl

  const knownChords = useMemo(() => extractUniqueChords(draft), [draft])

  const startEdit = () => {
    setDraft(text)
    setEditing(true)
  }

  const handleDone = async () => {
    await onUpdate('lyrics', draft)
    setEditing(false)
  }

  const insertChord = (chord: string) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const token = `[${chord}]`
    const next = draft.slice(0, start) + token + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
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
          {knownChords.length > 0 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px',
              borderBottom: '1px solid var(--line)', background: 'var(--bg-1)',
            }}>
              {knownChords.map(chord => (
                <button
                  key={chord}
                  onClick={() => insertChord(chord)}
                  style={{
                    padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)',
                    background: 'var(--bg-2)', color: '#7c9fff',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer', lineHeight: '18px',
                  }}
                >
                  {chord}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
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
