# Lyrics AI Helper — Design Spec

**Date:** 2026-04-28
**Status:** Approved

## Overview

An AI-powered lyrics brainstorm partner embedded in the LyricsTab editor. The goal is autocomplete-style assistance — not to write lyrics for the user, but to offer completions, next-line suggestions, and alternative phrasings that help them explore ideas. The AI learns the user's lyric style over time through a lightweight memory system.

---

## Settings

All lyrics AI settings are stored in `backupConfigs` under id `"lyrics_ai"` (same mechanism as AI provider config).

| Setting         | Type                                               | Default          | Description                                                                                  |
| --------------- | -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `enabled`       | boolean                                            | `false`          | Master toggle. When off, no debounce fires, no AI calls are made. All other settings hidden. |
| `mode`          | `"inline" \| "popup"`                              | `"inline"`       | How suggestions surface in the editor.                                                       |
| `enabled_modes` | `("completion" \| "alternative" \| "next_line")[]` | `["completion"]` | Which suggestion types the AI may generate. Multi-select.                                    |
| `feedback_mode` | `"minimal" \| "tagged"`                            | `"minimal"`      | Whether the user can tag rejections with a label.                                            |

A new **Lyrics AI** section is added to `SettingsModal.tsx` under the existing AI Assistant section. When `enabled` is false, all other controls collapse.

---

## Suggestion Modes

### Inline ghost text (`mode: "inline"`)

A backdrop `<div>` is absolutely positioned behind the `<textarea>`, mirroring it exactly (same font, padding, line-height, scroll offset). It renders all existing text in transparent color and the AI suggestion appended in faint accent-colored text (`opacity: 0.35`).

**Trigger:** 800ms debounce after the user stops typing. Mode is determined from cursor context:

- Cursor mid-line, text is incomplete → `completion`
- Cursor at end of a complete line → `next_line` (if enabled)
- Text is selected → `alternative` (if enabled)

**Accept:** `Tab` key inserts the suggestion into the draft. Logs an accepted event.
**Dismiss:** Any other keystroke clears ghost text. Logs a rejected event. In `tagged` feedback mode, a small dismissible chip appears briefly below the toolbar offering optional labels (`too cheesy`, `good rhyme`, `wrong vibe`, `other`). Tapping a label updates the rejection event's `tag` column; dismissing or ignoring the chip leaves `tag` null.

Tokens stream in live as the AI responds, so the suggestion types itself in character-by-character. A faint animated `...` appears while waiting for the first token. If no tokens arrive within 5s the request is cancelled silently.

### Triggered popup (`mode: "popup"`)

A floating panel anchored just below the current line. Triggered by the same 800ms debounce or manually with `Ctrl+Space` / `⌘Space`. Dismissed with `Escape` or clicking away.

Shows one suggestion per enabled mode (up to 3 rows). These are fetched in a **single `generateObject` call** that returns an array — one entry per enabled mode — rather than parallel calls. Each row shows the mode label and the suggestion text; clicking inserts it.

---

## AI Context (sent on every call)

```
- Full lyrics text (with section markers)
- Cursor position / current line text
- BPM, key, time signature, song title
- Global style profile summary (if exists)
- Per-project style profile summary (if exists)
- Last 5 accepted suggestion texts (as few-shot examples)
- List of enabled_modes (so the AI knows what to generate)
```

---

## Data Model

### `lyric_style_events`

One row per suggestion interaction.

| Column            | Type          | Notes                                                                                              |
| ----------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `id`              | text PK       |                                                                                                    |
| `project_id`      | text nullable | null = global                                                                                      |
| `suggestion_text` | text          |                                                                                                    |
| `mode`            | text          | `completion \| alternative \| next_line`                                                           |
| `accepted`        | integer       | 1 = accepted, 0 = rejected                                                                         |
| `tag`             | text nullable | `too_cheesy \| good_rhyme \| wrong_vibe \| other` — only populated when `feedback_mode = "tagged"` |
| `created_at`      | integer       | unix timestamp                                                                                     |

### `lyric_style_profile`

One row per scope (global or per-project).

| Column            | Type    | Notes                                           |
| ----------------- | ------- | ----------------------------------------------- |
| `id`              | text PK | `"global"` or a `project_id`                    |
| `summary_text`    | text    | AI-generated natural-language style description |
| `last_updated_at` | integer | unix timestamp                                  |

---

## Style Memory Lifecycle

1. **Event logging** — every accept (and every reject, in tagged mode) writes to `lyric_style_events`. Accepted suggestions write two rows: one scoped to the project, one with `project_id = null` (global).

2. **Profile regeneration** — after every 5 acceptances in a given scope, a background `generateStyleSummary` call fires with the last 20 accepted texts for that scope. The result overwrites `summary_text` in `lyric_style_profile`. This runs silently and never blocks the editor.

3. **Prompt injection** — on each suggestion call, both profile rows are prepended to the system prompt:

   ```
   Your style context:
   Global: tends toward ABAB rhyme, dark imagery, short punchy lines
   This song: more introspective, slower cadence
   ```

   If no profile exists yet, this section is omitted.

4. **Reset** — user can clear global or per-project memory from Settings. This deletes all `lyric_style_events` rows for that scope and removes the `lyric_style_profile` row.

---

## Error Handling

| Scenario                       | Behaviour                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| No AI config                   | Suggestions silently disabled (no errors in editor)                                |
| API error / network failure    | Ghost text / popup clears quietly; small `⚠` icon in lyrics toolbar fades after 3s |
| Slow response (>5s, no tokens) | Request cancelled silently, ghost text cleared                                     |
| `enabled = false`              | Debounce never starts — zero overhead                                              |

---

## New Files

| File                                             | Purpose                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| `src/lib/lyrics-ai.ts`                           | Prompt builder, suggestion logic, style context assembly  |
| `src/db/queries/lyrics-ai.ts`                    | Read/write `lyric_style_events` and `lyric_style_profile` |
| `src/components/detail/tabs/LyricsAiOverlay.tsx` | Backdrop ghost text + popup component                     |
| `src/components/settings/LyricsAiSettings.tsx`   | Settings panel section                                    |

### Modified Files

| File                                        | Change                                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| `src/lib/ai.ts`                             | Add `streamLyricsSuggestion()` and `generateStyleSummary()`    |
| `src/db/schema.ts`                          | Add `lyric_style_events` and `lyric_style_profile` tables      |
| `src/components/detail/tabs/LyricsTab.tsx`  | Integrate `LyricsAiOverlay`, wire debounce, handle Tab/dismiss |
| `src/components/settings/SettingsModal.tsx` | Add Lyrics AI settings section                                 |

---

## Testing

- `lyrics-ai.ts` prompt builder is a pure function — unit tested with no AI calls (assert on assembled prompt string)
- DB queries tested with in-memory SQLite
- Style regeneration threshold (every 5 accepts) tested by mocking `generateStyleSummary`
- Manual testing: inline mode, popup mode, accept/dismiss, RTL text compatibility, master toggle off
