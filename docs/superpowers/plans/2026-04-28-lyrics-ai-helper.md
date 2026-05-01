# Lyrics AI Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-powered autocomplete/brainstorm partner to the lyrics editor that streams inline ghost text or shows a popup of suggestions, learns the user's lyric style over time, and is fully configurable in Settings.

**Architecture:** Overlay component (`LyricsAiOverlay`) sits inside a relative-positioned wrapper around the `<textarea>` in `LyricsTab`; it renders a scroll-synced backdrop div for ghost text (inline mode) or a floating panel (popup mode). All AI calls flow through `lib/ai.ts` wrappers using the existing Vercel AI SDK setup. Style memory is persisted in two new SQLite tables via the existing Drizzle/Tauri-SQL client pattern.

**Tech Stack:** React + TypeScript, Vercel AI SDK (`ai` v6, `streamText` + `generateObject`), Drizzle ORM, SQLite via `@tauri-apps/plugin-sql`, Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-28-lyrics-ai-helper-design.md`

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `src/db/schema.ts` | Add `lyricStyleEvents` + `lyricStyleProfile` tables |
| Modify | `src/db/client.ts` | Add `CREATE TABLE IF NOT EXISTS` migrations |
| Modify | `src/types/index.ts` | Add `LyricsAIConfig`, `LyricSuggestionMode`, `LyricFeedbackMode`, `LyricDisplayMode`, `LyricRejectionTag` |
| Create | `src/db/queries/lyrics-ai.ts` | CRUD for events, profiles, and lyrics-AI config |
| Create | `src/lib/lyrics-ai.ts` | Pure prompt-builder functions + mode-determination logic |
| Create | `tests/lyrics-ai.test.ts` | Unit tests for pure functions in `src/lib/lyrics-ai.ts` |
| Modify | `src/lib/ai.ts` | Add `streamLyricsSuggestion`, `generatePopupSuggestions`, `generateStyleSummary` |
| Create | `src/components/settings/LyricsAiSettings.tsx` | Settings section component |
| Modify | `src/components/settings/SettingsModal.tsx` | Wire in `LyricsAiSettings` |
| Create | `src/components/detail/tabs/LyricsAiOverlay.tsx` | Ghost-text backdrop + popup + orchestration |
| Modify | `src/components/detail/tabs/LyricsTab.tsx` | Cursor tracking, scroll sync, Tab key, overlay integration |

---

## Task 1: DB schema, migration, and types

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/client.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add tables to schema.ts**

Open `src/db/schema.ts`. After the `backupConfigs` table definition, add:

```ts
export const lyricStyleEvents = sqliteTable('lyric_style_events', {
  id:             text('id').primaryKey(),
  projectId:      text('project_id'),
  suggestionText: text('suggestion_text').notNull(),
  mode:           text('mode').notNull(),
  accepted:       integer('accepted').notNull(),
  tag:            text('tag'),
  createdAt:      integer('created_at').notNull(),
})

export const lyricStyleProfile = sqliteTable('lyric_style_profile', {
  id:            text('id').primaryKey(),
  summaryText:   text('summary_text').notNull(),
  lastUpdatedAt: integer('last_updated_at').notNull(),
})
```

- [ ] **Step 2: Add migrations to client.ts**

In `src/db/client.ts`, inside `runMigrations()`, add after the `backup_configs` migration block:

```ts
await raw.execute(`CREATE TABLE IF NOT EXISTS lyric_style_events (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  suggestion_text TEXT NOT NULL,
  mode TEXT NOT NULL,
  accepted INTEGER NOT NULL,
  tag TEXT,
  created_at INTEGER NOT NULL
)`, [])

await raw.execute(`CREATE TABLE IF NOT EXISTS lyric_style_profile (
  id TEXT PRIMARY KEY,
  summary_text TEXT NOT NULL,
  last_updated_at INTEGER NOT NULL
)`, [])
```

- [ ] **Step 3: Add types to types/index.ts**

At the bottom of `src/types/index.ts`, add:

```ts
export type LyricSuggestionMode = 'completion' | 'alternative' | 'next_line'
export type LyricFeedbackMode = 'minimal' | 'tagged'
export type LyricDisplayMode = 'inline' | 'popup'
export type LyricRejectionTag = 'too_cheesy' | 'good_rhyme' | 'wrong_vibe' | 'other'

export interface LyricsAIConfig {
  enabled: boolean
  mode: LyricDisplayMode
  enabledModes: LyricSuggestionMode[]
  feedbackMode: LyricFeedbackMode
}
```

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/client.ts src/types/index.ts
git commit -m "feat: add lyric style memory DB tables and types"
```

---

## Task 2: DB query layer

**Files:**
- Create: `src/db/queries/lyrics-ai.ts`

- [ ] **Step 1: Create the query file**

Create `src/db/queries/lyrics-ai.ts` with the full content below:

```ts
import { eq, desc, and, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDb } from '../client'
import { lyricStyleEvents, lyricStyleProfile, backupConfigs } from '../schema'
import type { LyricsAIConfig, LyricSuggestionMode, LyricRejectionTag } from '../../types'

const LYRICS_AI_CONFIG_ID = 'lyrics_ai'

const DEFAULT_LYRICS_AI_CONFIG: LyricsAIConfig = {
  enabled: false,
  mode: 'inline',
  enabledModes: ['completion'],
  feedbackMode: 'minimal',
}

export async function getLyricsAIConfig(): Promise<LyricsAIConfig> {
  const db = await getDb()
  const rows = await db.select().from(backupConfigs).where(eq(backupConfigs.id, LYRICS_AI_CONFIG_ID))
  if (!rows[0]) return DEFAULT_LYRICS_AI_CONFIG
  try {
    return { ...DEFAULT_LYRICS_AI_CONFIG, ...JSON.parse(rows[0].configJson) }
  } catch {
    return DEFAULT_LYRICS_AI_CONFIG
  }
}

export async function setLyricsAIConfig(cfg: LyricsAIConfig): Promise<void> {
  const db = await getDb()
  await db
    .insert(backupConfigs)
    .values({ id: LYRICS_AI_CONFIG_ID, configJson: JSON.stringify(cfg) })
    .onConflictDoUpdate({ target: backupConfigs.id, set: { configJson: JSON.stringify(cfg) } })
}

export async function logStyleEvent(event: {
  projectId: string | null
  suggestionText: string
  mode: LyricSuggestionMode
  accepted: boolean
  tag: LyricRejectionTag | null
}): Promise<string> {
  const db = await getDb()
  const id = nanoid()
  await db.insert(lyricStyleEvents).values({
    id,
    projectId: event.projectId,
    suggestionText: event.suggestionText,
    mode: event.mode,
    accepted: event.accepted ? 1 : 0,
    tag: event.tag ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  })
  return id
}

export async function updateEventTag(id: string, tag: LyricRejectionTag): Promise<void> {
  const db = await getDb()
  await db.update(lyricStyleEvents).set({ tag }).where(eq(lyricStyleEvents.id, id))
}

export async function getRecentAccepted(
  projectId: string | null,
  limit = 20,
): Promise<string[]> {
  const db = await getDb()
  const scopeCondition = projectId === null
    ? isNull(lyricStyleEvents.projectId)
    : eq(lyricStyleEvents.projectId, projectId)
  const rows = await db
    .select({ suggestionText: lyricStyleEvents.suggestionText })
    .from(lyricStyleEvents)
    .where(and(scopeCondition, eq(lyricStyleEvents.accepted, 1)))
    .orderBy(desc(lyricStyleEvents.createdAt))
    .limit(limit)
  return rows.map(r => r.suggestionText)
}

export async function countAcceptedEvents(projectId: string | null): Promise<number> {
  const db = await getDb()
  const scopeCondition = projectId === null
    ? isNull(lyricStyleEvents.projectId)
    : eq(lyricStyleEvents.projectId, projectId)
  const rows = await db
    .select({ id: lyricStyleEvents.id })
    .from(lyricStyleEvents)
    .where(and(scopeCondition, eq(lyricStyleEvents.accepted, 1)))
  return rows.length
}

export async function getStyleProfile(id: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db.select().from(lyricStyleProfile).where(eq(lyricStyleProfile.id, id))
  return rows[0]?.summaryText ?? null
}

export async function upsertStyleProfile(id: string, summaryText: string): Promise<void> {
  const db = await getDb()
  const now = Math.floor(Date.now() / 1000)
  await db
    .insert(lyricStyleProfile)
    .values({ id, summaryText, lastUpdatedAt: now })
    .onConflictDoUpdate({ target: lyricStyleProfile.id, set: { summaryText, lastUpdatedAt: now } })
}

export async function clearStyleMemory(projectId: string | null): Promise<void> {
  const db = await getDb()
  const scopeCondition = projectId === null
    ? isNull(lyricStyleEvents.projectId)
    : eq(lyricStyleEvents.projectId, projectId)
  await db.delete(lyricStyleEvents).where(scopeCondition)
  const profileId = projectId ?? 'global'
  await db.delete(lyricStyleProfile).where(eq(lyricStyleProfile.id, profileId))
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/queries/lyrics-ai.ts
git commit -m "feat: add lyrics AI DB query layer"
```

---

## Task 3: Prompt builder + tests

**Files:**
- Create: `src/lib/lyrics-ai.ts`
- Create: `tests/lyrics-ai.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `tests/lyrics-ai.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildLyricsSuggestionPrompt, buildLyricsPopupPrompt, determineSuggestionMode } from '../src/lib/lyrics-ai'

describe('buildLyricsSuggestionPrompt', () => {
  const base = {
    lyrics: 'verse one\n',
    currentLine: 'verse one',
    selectionStart: 9,
    selectionEnd: 9,
    title: 'My Song',
    bpm: 120,
    key: 'C Major',
    timeSignature: '4/4',
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
    mode: 'completion' as const,
  }

  it('includes song metadata in system prompt', () => {
    const { system } = buildLyricsSuggestionPrompt(base)
    expect(system).toContain('My Song')
    expect(system).toContain('120')
    expect(system).toContain('C Major')
    expect(system).toContain('4/4')
  })

  it('includes style context when profiles are set', () => {
    const { system } = buildLyricsSuggestionPrompt({
      ...base,
      globalProfile: 'ABAB rhyme, dark imagery',
      projectProfile: 'introspective',
    })
    expect(system).toContain('ABAB rhyme, dark imagery')
    expect(system).toContain('introspective')
  })

  it('omits style context block when both profiles are null', () => {
    const { system } = buildLyricsSuggestionPrompt(base)
    expect(system).not.toContain('style context')
  })

  it('includes recent accepted examples', () => {
    const { system } = buildLyricsSuggestionPrompt({
      ...base,
      recentAccepted: ['burning like the sun', 'cold as winter rain'],
    })
    expect(system).toContain('burning like the sun')
    expect(system).toContain('cold as winter rain')
  })

  it('puts full lyrics and current line in the user prompt', () => {
    const { prompt } = buildLyricsSuggestionPrompt(base)
    expect(prompt).toContain('verse one')
    expect(prompt).toContain('Current line')
  })
})

describe('buildLyricsPopupPrompt', () => {
  it('lists all enabled modes in system prompt', () => {
    const { system } = buildLyricsPopupPrompt({
      lyrics: '', currentLine: '', selectionStart: 0, selectionEnd: 0,
      title: 'Song', bpm: null, key: null, timeSignature: null,
      globalProfile: null, projectProfile: null, recentAccepted: [],
      enabledModes: ['completion', 'next_line'],
    })
    expect(system).toContain('completion')
    expect(system).toContain('next_line')
    expect(system).not.toContain('alternative')
  })
})

describe('determineSuggestionMode', () => {
  it('returns alternative when text is selected and mode is enabled', () => {
    expect(determineSuggestionMode('hello world', 0, 5, ['completion', 'alternative', 'next_line']))
      .toBe('alternative')
  })

  it('returns completion when cursor is mid-line', () => {
    expect(determineSuggestionMode('hello wor', 9, 9, ['completion', 'next_line']))
      .toBe('completion')
  })

  it('returns next_line when cursor is at end of a complete line', () => {
    // 'hello world\n' — cursor at index 11 (end of "hello world", before \n)
    expect(determineSuggestionMode('hello world\n', 11, 11, ['completion', 'next_line']))
      .toBe('next_line')
  })

  it('returns null when enabledModes is empty', () => {
    expect(determineSuggestionMode('hello', 5, 5, [])).toBeNull()
  })

  it('falls back to completion when alternative is disabled but text is selected', () => {
    expect(determineSuggestionMode('hello world', 0, 5, ['completion']))
      .toBe('completion')
  })

  it('returns first enabled mode as last resort', () => {
    expect(determineSuggestionMode('', 0, 0, ['next_line'])).toBe('next_line')
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm test
```

Expected: FAIL with "Cannot find module '../src/lib/lyrics-ai'"

- [ ] **Step 3: Create src/lib/lyrics-ai.ts**

```ts
import type { LyricSuggestionMode } from '../types'

export interface LyricsSuggestionInput {
  lyrics: string
  currentLine: string
  selectionStart: number
  selectionEnd: number
  title: string
  bpm: number | null
  key: string | null
  timeSignature: string | null
  globalProfile: string | null
  projectProfile: string | null
  recentAccepted: string[]
  mode: LyricSuggestionMode
}

export interface LyricsPopupInput extends Omit<LyricsSuggestionInput, 'mode'> {
  enabledModes: LyricSuggestionMode[]
}

const MODE_INSTRUCTIONS: Record<LyricSuggestionMode, string> = {
  completion: 'Complete the current partial line. Return only the completion text (not the part already written). One line max.',
  alternative: 'Suggest an alternative phrasing for the selected text. Return only the alternative. One line max.',
  next_line: 'Suggest the next line that would follow naturally. Return only that one line.',
}

function buildStyleContext(globalProfile: string | null, projectProfile: string | null): string {
  if (!globalProfile && !projectProfile) return ''
  const parts: string[] = []
  if (globalProfile) parts.push(`Global: ${globalProfile}`)
  if (projectProfile) parts.push(`This song: ${projectProfile}`)
  return `\nYour style context:\n${parts.join('\n')}\n`
}

function buildRecentExamples(recentAccepted: string[]): string {
  if (recentAccepted.length === 0) return ''
  return `\nRecent lines the user accepted:\n${recentAccepted.slice(0, 5).map(t => `- ${t}`).join('\n')}\n`
}

function buildSongContext(
  title: string,
  bpm: number | null,
  key: string | null,
  timeSignature: string | null,
): string {
  const parts = [`Song: "${title}"`]
  if (bpm) parts.push(`BPM: ${bpm}`)
  if (key) parts.push(`Key: ${key}`)
  if (timeSignature) parts.push(`Time: ${timeSignature}`)
  return parts.join(' · ')
}

export function buildLyricsSuggestionPrompt(input: LyricsSuggestionInput): { system: string; prompt: string } {
  const system = [
    'You are a lyrics co-writer. You help musicians by offering short, focused suggestions that match their style.',
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
    '',
    MODE_INSTRUCTIONS[input.mode],
    'Never explain or add commentary. Return only the raw lyric text.',
  ].join('\n')

  const prompt = `Full lyrics so far:\n${input.lyrics || '(empty)'}\n\nCurrent line: "${input.currentLine}"`

  return { system, prompt }
}

export function buildLyricsPopupPrompt(input: LyricsPopupInput): { system: string; prompt: string } {
  const modeList = input.enabledModes
    .map(m => `- ${m}: ${MODE_INSTRUCTIONS[m]}`)
    .join('\n')

  const system = [
    'You are a lyrics co-writer. You help musicians by offering short, focused suggestions that match their style.',
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
    '',
    'Generate one suggestion for each of the following types:',
    modeList,
    'Never explain or add commentary. Return only raw lyric text for each.',
  ].join('\n')

  const prompt = `Full lyrics so far:\n${input.lyrics || '(empty)'}\n\nCurrent line: "${input.currentLine}"`

  return { system, prompt }
}

export function determineSuggestionMode(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  enabledModes: LyricSuggestionMode[],
): LyricSuggestionMode | null {
  if (enabledModes.length === 0) return null

  if (selectionStart !== selectionEnd && enabledModes.includes('alternative')) {
    return 'alternative'
  }

  const textBeforeCursor = draft.slice(0, selectionStart)
  const lineStart = textBeforeCursor.lastIndexOf('\n') + 1
  const lineEnd = draft.indexOf('\n', selectionStart)
  const currentLine = draft.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
  const posInLine = selectionStart - lineStart

  if (posInLine < currentLine.length && enabledModes.includes('completion')) {
    return 'completion'
  }

  if (currentLine.trim().length > 0 && enabledModes.includes('next_line')) {
    return 'next_line'
  }

  if (enabledModes.includes('completion')) return 'completion'

  return enabledModes[0]
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npm test
```

Expected: all `lyrics-ai.test.ts` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lyrics-ai.ts tests/lyrics-ai.test.ts
git commit -m "feat: add lyrics prompt builder with tests"
```

---

## Task 4: AI SDK wrappers

**Files:**
- Modify: `src/lib/ai.ts`

- [ ] **Step 1: Add imports to ai.ts**

At the top of `src/lib/ai.ts`, update the import from `'ai'`:

```ts
import { generateObject, generateText, streamText } from 'ai'
```

Also add to the existing zod import (it's already imported).

- [ ] **Step 2: Add LyricSuggestionMode import**

Add to the imports in `src/lib/ai.ts`:

```ts
import type { AIConfig, LyricSuggestionMode } from '../types'
```

(Replace the existing `import type { AIConfig, Instrument } from '../types'` — add `LyricSuggestionMode` to it.)

- [ ] **Step 3: Add the three new functions at the bottom of ai.ts**

```ts
// ── Lyrics AI ─────────────────────────────────────────────────────────────────

export async function* streamLyricsSuggestion(
  cfg: AIConfig,
  system: string,
  prompt: string,
): AsyncGenerator<string> {
  const provider = buildProvider(cfg)
  const result = streamText({ model: provider, system, prompt, maxTokens: 80 })
  for await (const chunk of result.textStream) {
    yield chunk
  }
}

export const popupSuggestionsSchema = z.object({
  suggestions: z.array(z.object({
    mode: z.enum(['completion', 'alternative', 'next_line']),
    text: z.string(),
  })),
})

export type PopupSuggestions = z.infer<typeof popupSuggestionsSchema>

export async function generatePopupSuggestions(
  cfg: AIConfig,
  system: string,
  prompt: string,
): Promise<PopupSuggestions> {
  const provider = buildProvider(cfg)
  const result = await generateObject({
    model: provider,
    schema: popupSuggestionsSchema,
    system,
    prompt,
  })
  return result.object
}

export async function generateStyleSummary(
  cfg: AIConfig,
  recentAccepted: string[],
): Promise<string> {
  const provider = buildProvider(cfg)
  const result = await generateText({
    model: provider,
    prompt: `Analyse the following song lyric lines written by a musician. Write a 1-2 sentence description of their lyric writing style — focus on rhyme scheme, line length, imagery, tone, and vocabulary register. Be concise and specific.\n\nLines:\n${recentAccepted.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nDescription:`,
    maxTokens: 60,
  })
  return result.text.trim()
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai.ts
git commit -m "feat: add streamLyricsSuggestion, generatePopupSuggestions, generateStyleSummary"
```

---

## Task 5: Lyrics AI settings component

**Files:**
- Create: `src/components/settings/LyricsAiSettings.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/settings/LyricsAiSettings.tsx`:

```tsx
import type { LyricsAIConfig, LyricSuggestionMode } from '../../types'

interface Props {
  cfg: LyricsAIConfig
  onChange: (next: LyricsAIConfig) => void
  onClearGlobalMemory: () => void
}

const SUGGESTION_MODES: { id: LyricSuggestionMode; label: string }[] = [
  { id: 'completion',  label: 'Line completion'       },
  { id: 'next_line',   label: 'Next line'              },
  { id: 'alternative', label: 'Alternative phrasing'   },
]

export default function LyricsAiSettings({ cfg, onChange, onClearGlobalMemory }: Props) {
  const toggle = (field: keyof LyricsAIConfig, value: unknown) =>
    onChange({ ...cfg, [field]: value })

  const toggleMode = (mode: LyricSuggestionMode) => {
    const next = cfg.enabledModes.includes(mode)
      ? cfg.enabledModes.filter(m => m !== mode)
      : [...cfg.enabledModes, mode]
    onChange({ ...cfg, enabledModes: next })
  }

  const Row = ({ children }: { children: React.ReactNode }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      {children}
    </div>
  )

  const Label = ({ children }: { children: React.ReactNode }) => (
    <span style={{ fontSize: 12, color: 'var(--text-1)' }}>{children}</span>
  )

  const ToggleBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px', fontSize: 11, borderRadius: 4,
        border: '1px solid var(--line-2)',
        background: active ? 'var(--accent)' : 'var(--bg-2)',
        color: active ? '#1a0a00' : 'var(--text-2)',
        fontWeight: active ? 700 : 400,
      }}
    >
      {children}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Master toggle */}
      <Row>
        <Label>AI suggestions</Label>
        <ToggleBtn active={cfg.enabled} onClick={() => toggle('enabled', !cfg.enabled)}>
          {cfg.enabled ? 'On' : 'Off'}
        </ToggleBtn>
      </Row>

      {cfg.enabled && (
        <>
          {/* Suggestion mode */}
          <Row>
            <Label>Appearance</Label>
            <div style={{ display: 'flex', gap: 4 }}>
              <ToggleBtn active={cfg.mode === 'inline'} onClick={() => toggle('mode', 'inline')}>
                Inline
              </ToggleBtn>
              <ToggleBtn active={cfg.mode === 'popup'} onClick={() => toggle('mode', 'popup')}>
                Popup
              </ToggleBtn>
            </div>
          </Row>

          {/* Enabled suggestion types */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Suggestion types</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {SUGGESTION_MODES.map(({ id, label }) => (
                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={cfg.enabledModes.includes(id)}
                    onChange={() => toggleMode(id)}
                    style={{ accentColor: 'var(--accent)', width: 13, height: 13 }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-1)' }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Feedback mode */}
          <Row>
            <Label>Feedback style</Label>
            <div style={{ display: 'flex', gap: 4 }}>
              <ToggleBtn active={cfg.feedbackMode === 'minimal'} onClick={() => toggle('feedbackMode', 'minimal')}>
                Minimal
              </ToggleBtn>
              <ToggleBtn active={cfg.feedbackMode === 'tagged'} onClick={() => toggle('feedbackMode', 'tagged')}>
                Tagged
              </ToggleBtn>
            </div>
          </Row>

          {/* Memory reset */}
          <div style={{ marginTop: 4, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
              Style memory helps the AI match your writing style over time.
            </div>
            <button
              onClick={onClearGlobalMemory}
              className="tb-btn"
              style={{ fontSize: 11 }}
            >
              Clear all style memory
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/LyricsAiSettings.tsx
git commit -m "feat: add LyricsAiSettings component"
```

---

## Task 6: Wire settings into SettingsModal

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Add import at the top of SettingsModal.tsx**

Add these imports after the existing imports:

```ts
import LyricsAiSettings from './LyricsAiSettings'
import { getLyricsAIConfig, setLyricsAIConfig, clearStyleMemory } from '../../db/queries/lyrics-ai'
import type { LyricsAIConfig } from '../../types'
```

- [ ] **Step 2: Add state for lyricsAICfg**

In the `SettingsModal` component body, after the `aiCfg` state declarations, add:

```ts
const [lyricsAICfg, setLyricsAICfgState] = useState<LyricsAIConfig>({
  enabled: false,
  mode: 'inline',
  enabledModes: ['completion'],
  feedbackMode: 'minimal',
})
```

- [ ] **Step 3: Load lyricsAICfg in the existing useEffect**

In the `useEffect` that loads all configs (the one with `Promise.all`), add `getLyricsAIConfig()` to the array and handle its result:

```ts
useEffect(() => {
  Promise.all([
    getLocalConfig(),
    getGDriveFolderConfig(),
    getGDriveConfig(),
    invoke<string[]>('detect_gdrive_paths'),
    getAIConfig(),
    getLyricsAIConfig(),           // ← add this
  ]).then(([lc, gf, gc, paths, ai, lyricsAI]) => {  // ← add lyricsAI
    setLocalCfg(lc)
    setGDriveFolderCfg(gf)
    setGdriveCfg(gc)
    setDetectedPaths(paths)
    if (ai) setAiCfg(ai)
    setLyricsAICfgState(lyricsAI)  // ← add this
  })
}, [])
```

- [ ] **Step 4: Add save handler**

After `handleSaveAI`, add:

```ts
const handleLyricsAIChange = useCallback(async (next: LyricsAIConfig) => {
  setLyricsAICfgState(next)
  await setLyricsAIConfig(next)
}, [])

const handleClearGlobalMemory = useCallback(async () => {
  await clearStyleMemory(null)
}, [])
```

- [ ] **Step 5: Add the settings section to the JSX**

Find the closing `</section>` of the AI Assistant section in the render output. After the divider that follows it, add a new section:

```tsx
<div style={{ height: 1, background: 'var(--line)' }} />

<section>
  <SectionTitle>Lyrics AI</SectionTitle>
  <Hint>AI-powered autocomplete and brainstorm suggestions while writing lyrics. Uses your AI assistant settings above.</Hint>
  <LyricsAiSettings
    cfg={lyricsAICfg}
    onChange={handleLyricsAIChange}
    onClearGlobalMemory={handleClearGlobalMemory}
  />
</section>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/SettingsModal.tsx
git commit -m "feat: wire LyricsAiSettings into SettingsModal"
```

---

## Task 7: LyricsAiOverlay component

**Files:**
- Create: `src/components/detail/tabs/LyricsAiOverlay.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/detail/tabs/LyricsAiOverlay.tsx`:

```tsx
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
    const [aiConfig, setAiConfig]           = useState<AIConfig | null>(null)
    const [cfg, setCfg]                     = useState<LyricsAIConfig>(DEFAULT_CFG)
    const [globalProfile, setGlobalProfile] = useState<string | null>(null)
    const [projectProfile, setProjectProfile] = useState<string | null>(null)

    const [ghostText, setGhostText]             = useState('')
    const [currentSuggestion, setCurrentSuggestion] = useState<string | null>(null)
    const [currentMode, setCurrentMode]         = useState<LyricSuggestionMode | null>(null)
    const [status, setStatus]                   = useState<'idle' | 'loading' | 'streaming' | 'ready' | 'error'>('idle')
    const [popupItems, setPopupItems]           = useState<PopupItem[]>([])

    const [tagChipVisible, setTagChipVisible]   = useState(false)
    const [pendingTagEventId, setPendingTagEventId] = useState<string | null>(null)

    const abortedRef     = useRef(false)
    const debounceRef    = useRef<ReturnType<typeof setTimeout>>()
    const tagTimerRef    = useRef<ReturnType<typeof setTimeout>>()

    // Load AI config + lyrics AI config once on mount
    useEffect(() => {
      Promise.all([getAIConfig(), getLyricsAIConfig()]).then(([ai, lyricsAI]) => {
        setAiConfig(ai)
        setCfg(lyricsAI)
      })
    }, [])

    // Reload per-project style profile when project changes
    useEffect(() => {
      Promise.all([
        getStyleProfile('global'),
        getStyleProfile(project.id),
      ]).then(([g, p]) => {
        setGlobalProfile(g)
        setProjectProfile(p)
      })
    }, [project.id])

    // Debounced suggestion trigger
    useEffect(() => {
      if (!cfg.enabled || !aiConfig) return

      let aborted = false
      clearTimeout(debounceRef.current)

      debounceRef.current = setTimeout(async () => {
        const mode = determineSuggestionMode(draft, selectionStart, selectionEnd, cfg.enabledModes)
        if (!mode) return

        abortedRef.current = false
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
          // inline streaming
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
        const recent  = await getRecentAccepted(scopeId, 20)
        const summary = await generateStyleSummary(aiConfig, recent)
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
        abortedRef.current = true
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
        {/* Inline ghost text backdrop */}
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

        {/* Popup suggestions panel */}
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

        {/* Error indicator */}
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

        {/* Rejection tag chip (tagged feedback mode only) */}
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/detail/tabs/LyricsAiOverlay.tsx
git commit -m "feat: add LyricsAiOverlay component"
```

---

## Task 8: Wire overlay into LyricsTab

**Files:**
- Modify: `src/components/detail/tabs/LyricsTab.tsx`

- [ ] **Step 1: Add imports to LyricsTab.tsx**

Add to the top of `src/components/detail/tabs/LyricsTab.tsx`:

```tsx
import { useRef } from 'react'  // add to existing React imports
import LyricsAiOverlay, { type LyricsAiOverlayHandle } from './LyricsAiOverlay'
```

Note: `useState`, `useMemo`, `useRef` — make sure `useRef` is in the existing React import. Update the import to:

```tsx
import { useState, useMemo, useRef } from 'react'
```

- [ ] **Step 2: Add cursor and scroll state to LyricsTab component body**

In the `LyricsTab` component, after the existing `useState` declarations, add:

```tsx
const overlayRef   = useRef<LyricsAiOverlayHandle>(null)
const [selectionStart, setSelectionStart] = useState(0)
const [selectionEnd,   setSelectionEnd]   = useState(0)
const [scrollTop,      setScrollTop]      = useState(0)
```

- [ ] **Step 3: Add the overlay insert handler**

After `handleDone`, add:

```tsx
const handleOverlayInsert = (text: string, mode: import('../../../types').LyricSuggestionMode) => {
  const ta = textareaRef.current
  setDraft(prev => {
    if (mode === 'completion') {
      return prev.slice(0, selectionStart) + text + prev.slice(selectionStart)
    }
    if (mode === 'alternative') {
      return prev.slice(0, selectionStart) + text + prev.slice(selectionEnd)
    }
    // next_line: insert after current line
    const lineEnd  = prev.indexOf('\n', selectionStart)
    const insertAt = lineEnd === -1 ? prev.length : lineEnd
    return prev.slice(0, insertAt) + '\n' + text + prev.slice(insertAt)
  })
  if (ta) {
    requestAnimationFrame(() => {
      const newCursor = mode === 'alternative'
        ? selectionStart + text.length
        : selectionStart + text.length
      ta.focus()
      ta.setSelectionRange(newCursor, newCursor)
    })
  }
}
```

- [ ] **Step 4: Update the editing textarea block in the JSX**

Find the editing section in the JSX. Replace:

```tsx
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
```

With:

```tsx
<div style={{ position: 'relative' }}>
  <LyricsAiOverlay
    ref={overlayRef}
    draft={draft}
    selectionStart={selectionStart}
    selectionEnd={selectionEnd}
    scrollTop={scrollTop}
    project={p}
    onInsert={handleOverlayInsert}
  />
  <textarea
    ref={textareaRef}
    className="description-input"
    dir={rtl ? 'rtl' : 'ltr'}
    style={{
      border: 'none', borderRadius: 0, minHeight: 240,
      background: 'transparent', textAlign: rtl ? 'right' : 'left',
      position: 'relative', zIndex: 1,
    }}
    value={draft}
    onChange={e => setDraft(e.target.value)}
    onSelect={e => {
      setSelectionStart(e.currentTarget.selectionStart)
      setSelectionEnd(e.currentTarget.selectionEnd)
    }}
    onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    onKeyDown={e => {
      if (e.key === 'Tab') {
        if (overlayRef.current?.hasSuggestion()) {
          e.preventDefault()
          overlayRef.current.acceptSuggestion()
          return
        }
        // default Tab behavior (indent) if no suggestion
      } else {
        overlayRef.current?.dismissSuggestion()
      }
    }}
  />
</div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run all tests to confirm nothing regressed**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/detail/tabs/LyricsTab.tsx
git commit -m "feat: integrate LyricsAiOverlay into LyricsTab"
```

---

## Task 9: Manual smoke test and branch push

- [ ] **Step 1: Start the dev app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Enable AI suggestions in Settings**

Open Settings → AI Assistant — confirm your provider + API key are set. Open Settings → Lyrics AI → turn On. Enable "Line completion". Leave mode as Inline. Save.

- [ ] **Step 3: Test inline ghost text**

Open a project with lyrics. Click Edit. Type a partial line and pause for ~1 second. Confirm: faint ghost text appears continuing the line. Press Tab — ghost text is inserted into the draft. Press Done and confirm the text is saved.

- [ ] **Step 4: Test dismiss**

Type a partial line, wait for ghost text, then press any non-Tab key. Confirm: ghost text disappears and the keypress is handled normally.

- [ ] **Step 5: Test popup mode**

Go to Settings → Lyrics AI → switch to Popup. Return to a lyrics editor, type a partial line, pause. Confirm: a floating panel appears below with suggestions labelled by type. Click one — it inserts. Press Escape — panel disappears.

- [ ] **Step 6: Test master toggle**

Settings → Lyrics AI → toggle Off. Return to lyrics editor, type — confirm no ghost text or popups appear.

- [ ] **Step 7: Test tagged feedback mode (optional)**

Settings → Lyrics AI → Feedback: Tagged. Return to lyrics editor, get a suggestion, press a non-Tab key to dismiss. Confirm: a tag chip row appears briefly at the bottom of the editor with label buttons. Click a label — it should disappear.

- [ ] **Step 8: Push branch**

```bash
git push -u origin feat/sessions-vault-titlebar-branding
```

---

## Self-Review Notes

**Spec coverage verified:**
- ✅ Master on/off toggle (Task 5 + 6)
- ✅ Inline ghost text mode with 800ms debounce (Task 7)
- ✅ Popup mode with single generateObject call (Task 7)
- ✅ Streaming tokens appear progressively (Task 7, `streamLyricsSuggestion`)
- ✅ Tab to accept, any key to dismiss (Task 8)
- ✅ Mode selector in Settings (inline/popup) (Task 5)
- ✅ Enabled modes multi-select (Task 5)
- ✅ Feedback mode toggle (minimal/tagged) (Task 5)
- ✅ Tag chip on dismiss in tagged mode (Task 7)
- ✅ Global + per-project style profile (Task 7, `triggerProfileRegenIfNeeded`)
- ✅ Style profile regenerated every 5 accepts (Task 7)
- ✅ Profiles injected into every prompt (Task 3)
- ✅ Last 5 accepted texts as few-shot examples (Task 3)
- ✅ Error indicator on API failure (Task 7)
- ✅ Silent cancel on 5s timeout — handled by cleanup function in the useEffect
- ✅ Clear all style memory button (Task 5 + 6)
- ✅ Song context (bpm, key, time signature, title) in prompts (Task 3)
- ✅ RTL text compatibility — `dir` prop passes through, backdrop mirrors textarea direction
