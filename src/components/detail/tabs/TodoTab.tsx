import { useState, useRef } from 'react'
import Icon from '../../shared/Icon'
import type { Project } from '../../../types'

interface TodoItem { id: string; text: string; done: boolean }

interface Props {
  project: Project
  onUpdate: (field: string, value: unknown) => void
}

export default function TodoTab({ project: p, onUpdate }: Props) {
  const [items, setItems] = useState<TodoItem[]>(() => {
    try { return JSON.parse(p.todos ?? '[]') } catch { return [] }
  })
  const [newText, setNewText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const save = (next: TodoItem[]) => {
    setItems(next)
    onUpdate('todos', JSON.stringify(next))
  }

  const toggle = (id: string) =>
    save(items.map(t => t.id === id ? { ...t, done: !t.done } : t))

  const remove = (id: string) =>
    save(items.filter(t => t.id !== id))

  const add = () => {
    const text = newText.trim()
    if (!text) return
    save([...items, { id: crypto.randomUUID(), text, done: false }])
    setNewText('')
    inputRef.current?.focus()
  }

  return (
    <>
      <div className="session-list">
        {items.map(t => (
          <div key={t.id} className={`session-item ${t.done ? 'done' : ''}`} style={{ cursor: 'default' }}>
            <div className="check" style={{ cursor: 'pointer' }} onClick={() => toggle(t.id)}>
              {t.done && <Icon name="check" size={10} stroke={3} />}
            </div>
            <span className="txt" style={{ cursor: 'pointer' }} onClick={() => toggle(t.id)}>{t.text}</span>
            <button
              onClick={() => remove(t.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: '0 2px',
                opacity: 0.5 }}
              title="Remove"
            >×</button>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-3)' }}>No tasks yet.</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input
          ref={inputRef}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add a task…"
          style={{ flex: 1, background: 'var(--bg-2)', border: '1px solid var(--line)',
            borderRadius: 'var(--radius-m)', color: 'var(--text-1)', fontSize: 12,
            padding: '8px 10px', outline: 'none' }}
        />
        <button
          onClick={add}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-m)',
            color: '#000', fontWeight: 700, fontSize: 16, padding: '0 14px', cursor: 'pointer' }}
        >+</button>
      </div>
    </>
  )
}
