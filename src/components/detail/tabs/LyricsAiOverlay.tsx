import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { getAIConfig } from '../../../db/queries/ai'
import {
  getLyricsAIConfig,
  getStyleProfile,
  logStyleEvent,
  updateEventTag,
  countAcceptedEvents,
  getRecentAccepted,
  upsertStyleProfile,
} from '../../../db/queries/lyrics-ai'
import {
  streamLyricsSuggestion,
  generatePopupSuggestions,
  generateStyleSummary,
} from '../../../lib/ai'
import {
  buildLyricsSuggestionPrompt,
  buildLyricsPopupPrompt,
  determineSuggestionMode,
} from '../../../lib/lyrics-ai'
import type {
  Project,
  AIConfig,
  LyricsAIConfig,
  LyricSuggestionMode,
  LyricRejectionTag,
} from '../../../types'

export interface LyricsAiOverlayHandle {
  hasSuggestion: () => boolean
  acceptSuggestion: () => void
  dismissSuggestion: () => void
}

interface PopupItem {
  mode: LyricSuggestionMode
  text: string
}

interface Props {
  draft: string
  selectionStart: number
  selectionEnd: number
  scrollTop: number
  project: Project
  onInsert: (text: string, mode: LyricSuggestionMode) => void
}

const DEFAULT_CFG: LyricsAIConfig = {
  enabled: false,
  mode: 'inline',
  enabledModes: ['completion'],
  feedbackMode: 'minimal',
}

const BACKDROP_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: '12.5px',
  lineHeight: '1.55',
  letterSpacing: '-0.005em',
  padding: '10px 12px',
  whiteSpace: 'pre-wrap',
  wordWrap: 'break-word',
  width: '100%',
  boxSizing: 'border-box',
}

const REJECTION_TAGS: LyricRejectionTag[] = ['too_cheesy', 'good_rhyme', 'wrong_vibe', 'other']

const LyricsAiOverlay = forwardRef<LyricsAiOverlayHandle, Props>(
  ({ draft, selectionStart, selectionEnd, scrollTop, project, onInsert }, ref) => {
    const [aiConfig, setAiConfig]             = useState<AIConfig | null>(null)
    const [cfg, setCfg]                       = useState<LyricsAIConfig>(DEFAULT_CFG)
    const [globalProfile, setGlobalProfile]   = useState<string | null>(null)
    const [projectProfile, setProjectProfile] = useState<string | null>(null)

    const [ghostText, setGhostText]                   = useState('')
    const [currentSuggestion, setCurrentSuggestion]   = useState<string | null>(null)
    const [currentMode, setCurrentMode]               = useState<LyricSuggestionMode | null>(null)
    const [status, setStatus]                         = useState<'idle' | 'loading' | 'streaming' | 'ready' | 'error'>('idle')
    const [popupItems, setPopupItems]                 = useState<PopupItem[]>([])

    const [tagChipVisible, setTagChipVisible]         = useState(false)
    const [pendingTagEventId, setPendingTagEventId]   = useState<string | null>(null)

    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const tagTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(() => {
      Promise.all([getAIConfig(), getLyricsAIConfig()]).then(([ai, lyricsAI]) => {
        setAiConfig(ai)
        setCfg(lyricsAI)
      })
    }, [])

    useEffect(() => {
      Promise.all([
        getStyleProfile('global'),
        getStyleProfile(project.id),
      ]).then(([g, p]) => {
        setGlobalProfile(g)
        setProjectProfile(p)
      })
    }, [project.id])

    useEffect(() => {
      if (!cfg.enabled || !aiConfig) return

      let aborted = false
      clearTimeout(debounceRef.current)

      debounceRef.current = setTimeout(async () => {
        const mode = determineSuggestionMode(draft, selectionStart, selectionEnd, cfg.enabledModes)
        if (!mode) return

        setCurrentMode(mode)

        const textBeforeCursor = draft.slice(0, selectionStart)
        const lineStart        = textBeforeCursor.lastIndexOf('\n') + 1
        const lineEnd          = draft.indexOf('\n', selectionStart)
        const currentLine      = draft.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)

        const recentAccepted = await getRecentAccepted(project.id, 5)

        const baseInput = {
          lyrics: draft,
          currentLine,
          selectionStart,
          selectionEnd,
          title: project.title,
          bpm: project.bpm,
          key: project.key,
          timeSignature: project.timeSignature,
          globalProfile,
          projectProfile,
          recentAccepted,
        }

        if (cfg.mode === 'popup') {
          setStatus('loading')
          try {
            const { system, prompt } = buildLyricsPopupPrompt({
              ...baseInput,
              enabledModes: cfg.enabledModes,
            })
            const result = await generatePopupSuggestions(aiConfig, system, prompt)
            if (!aborted) {
              setPopupItems(result.suggestions)
              setStatus('ready')
            }
          } catch {
            if (!aborted) {
              setStatus('error')
              setTimeout(() => setStatus('idle'), 3000)
            }
          }
        } else {
          setGhostText('')
          setCurrentSuggestion(null)
          setStatus('loading')
          try {
            const { system, prompt } = buildLyricsSuggestionPrompt({ ...baseInput, mode })
            let accumulated = ''
            for await (const chunk of streamLyricsSuggestion(aiConfig, system, prompt)) {
              if (aborted) break
              accumulated += chunk
              setGhostText(accumulated)
              setStatus('streaming')
            }
            if (!aborted && accumulated) {
              setCurrentSuggestion(accumulated)
              setStatus('ready')
            } else if (!aborted) {
              setStatus('idle')
            }
          } catch {
            if (!aborted) {
              setGhostText('')
              setStatus('error')
              setTimeout(() => setStatus('idle'), 3000)
            }
          }
        }
      }, 800)

      return () => {
        clearTimeout(debounceRef.current)
        aborted = true
      }
    }, [draft, selectionStart, selectionEnd, cfg, aiConfig, project, globalProfile, projectProfile])

    const triggerProfileRegenIfNeeded = useCallback(async (scopeId: string | null) => {
      if (!aiConfig) return
      const count = await countAcceptedEvents(scopeId)
      if (count > 0 && count % 5 === 0) {
        const recent    = await getRecentAccepted(scopeId, 20)
        const summary   = await generateStyleSummary(aiConfig, recent)
        const profileId = scopeId ?? 'global'
        await upsertStyleProfile(profileId, summary)
        if (scopeId === null) setGlobalProfile(summary)
        else setProjectProfile(summary)
      }
    }, [aiConfig])

    const handleAccept = useCallback(async (text: string, mode: LyricSuggestionMode) => {
      onInsert(text, mode)
      setGhostText('')
      setCurrentSuggestion(null)
      setStatus('idle')
      setPopupItems([])

      await Promise.all([
        logStyleEvent({ projectId: null,       suggestionText: text, mode, accepted: true, tag: null }),
        logStyleEvent({ projectId: project.id, suggestionText: text, mode, accepted: true, tag: null }),
      ])

      triggerProfileRegenIfNeeded(null)
      triggerProfileRegenIfNeeded(project.id)
    }, [onInsert, project.id, triggerProfileRegenIfNeeded])

    const handleReject = useCallback(async (text: string, mode: LyricSuggestionMode) => {
      setGhostText('')
      setCurrentSuggestion(null)
      setStatus('idle')
      setPopupItems([])

      if (cfg.feedbackMode === 'tagged') {
        const eventId = await logStyleEvent({
          projectId: project.id, suggestionText: text, mode, accepted: false, tag: null,
        })
        setPendingTagEventId(eventId)
        setTagChipVisible(true)
        clearTimeout(tagTimerRef.current)
        tagTimerRef.current = setTimeout(() => {
          setTagChipVisible(false)
          setPendingTagEventId(null)
        }, 3000)
      }
    }, [cfg.feedbackMode, project.id])

    useImperativeHandle(ref, () => ({
      hasSuggestion: () => cfg.mode === 'inline' && !!currentSuggestion,
      acceptSuggestion: () => {
        if (currentSuggestion && currentMode) handleAccept(currentSuggestion, currentMode)
      },
      dismissSuggestion: () => {
        if (currentSuggestion && currentMode) {
          handleReject(currentSuggestion, currentMode)
        } else {
          setGhostText('')
          setCurrentSuggestion(null)
          setStatus('idle')
        }
      },
    }), [cfg.mode, currentSuggestion, currentMode, handleAccept, handleReject])

    if (!cfg.enabled) return null

    return (
      <>
        {cfg.mode === 'inline' && (
          <div style={{
            position: 'absolute', inset: 0,
            overflow: 'hidden', pointerEvents: 'none', zIndex: 0,
          }}>
            <div style={{
              ...BACKDROP_STYLE,
              transform: `translateY(-${scrollTop}px)`,
              color: 'transparent',
            }}>
              {draft}
              {status === 'loading' && !ghostText && (
                <span style={{ color: 'var(--accent)', opacity: 0.4 }}>…</span>
              )}
              {ghostText && (
                <span style={{ color: 'var(--accent)', opacity: 0.4 }}>{ghostText}</span>
              )}
            </div>
          </div>
        )}

        {cfg.mode === 'popup' && (status === 'loading' || status === 'ready') && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4,
            zIndex: 20, background: 'var(--bg-2)',
            border: '1px solid var(--line-2)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
          }}>
            {status === 'loading' && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>
                Thinking…
              </div>
            )}
            {status === 'ready' && popupItems.map((item, i) => (
              <button
                key={i}
                onClick={() => handleAccept(item.text, item.mode)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '9px 12px', textAlign: 'left',
                  borderBottom: i < popupItems.length - 1 ? '1px solid var(--line)' : 'none',
                  background: 'transparent',
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: 'var(--accent)', flexShrink: 0, paddingTop: 2,
                }}>
                  {item.mode.replace('_', ' ')}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-0)', lineHeight: 1.5 }}>
                  {item.text}
                </span>
              </button>
            ))}
          </div>
        )}

        {status === 'error' && (
          <span
            title="AI suggestion failed"
            style={{
              position: 'absolute', right: 10, top: 8,
              fontSize: 13, opacity: 0.6, pointerEvents: 'none', zIndex: 5,
            }}
          >
            ⚠
          </span>
        )}

        {tagChipVisible && (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: -34,
            display: 'flex', gap: 5, padding: '5px 12px',
            background: 'var(--bg-1)', borderTop: '1px solid var(--line)', zIndex: 20,
          }}>
            {REJECTION_TAGS.map(tag => (
              <button
                key={tag}
                onClick={async () => {
                  if (pendingTagEventId) await updateEventTag(pendingTagEventId, tag)
                  setTagChipVisible(false)
                  setPendingTagEventId(null)
                }}
                style={{
                  fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
                  background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                  color: 'var(--text-2)',
                }}
              >
                {tag.replace('_', ' ')}
              </button>
            ))}
          </div>
        )}
      </>
    )
  }
)

LyricsAiOverlay.displayName = 'LyricsAiOverlay'
export default LyricsAiOverlay
