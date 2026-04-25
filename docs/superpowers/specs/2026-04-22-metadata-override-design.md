# BPM / Key / Time Signature Override — Design Spec

**Date:** 2026-04-22
**Status:** Approved

---

## Overview

Make the BPM, Key, and Time Signature cells in the Overview tab's Details grid click-to-edit. Tracks remains read-only (scanner-derived). Edits write to the existing `bpm`, `key`, `timeSignature` columns via `updateProjectField`.

---

## Components

### `EditableCell`

**Location:** `src/components/shared/EditableCell.tsx`

Handles the click-to-edit pattern for BPM and Time Signature (plain text/number inputs).

**Props:**
```ts
interface Props {
  label: string
  value: string | number | null
  type: 'text' | 'number'
  min?: number
  max?: number
  onSave: (value: string | number | null) => void
}
```

**Behavior:**
- Closed: displays `value ?? '—'` with a `cursor: text` pointer on hover
- Open: replaces value with an `<input>` (auto-focused, pre-filled with current value)
- Enter or blur → calls `onSave(parsedValue)` and closes
- Escape → closes without saving
- For `type='number'`: parses to float, clamps to min/max if provided, rejects non-numeric input (saves null if cleared)
- For `type='text'`: trims whitespace, saves null if empty

### `KeyPicker`

**Location:** `src/components/shared/KeyPicker.tsx`

**Props:**
```ts
interface Props {
  value: string | null   // e.g. "G minor", "C# major", null
  onSave: (value: string | null) => void
}
```

**Behavior:**
- Closed: displays `value ?? '—'` with cursor text on hover
- Open: a small inline panel showing:
  - 12 root note buttons in chromatic order: C  C#  D  D#  E  F  F#  G  G#  A  A#  B
  - Major / Minor toggle (two buttons)
  - Clicking a root note while mode is selected → commits `"<root> <mode>"` and closes
  - Clicking mode toggle alone → stays open (must pick root to commit)
  - Current value's root and mode are pre-highlighted when opened
- Escape or click outside → closes without saving
- "Clear" link → saves null and closes

**Stored format:** `"<root> <mode>"` lowercase, e.g. `"g minor"`, `"c# major"`

---

## Wiring in `OverviewTab`

Replace the static Details grid with individual `EditableCell` and `KeyPicker` cells:

```tsx
<div className="meta-grid">
  <EditableCell label="BPM" value={p.bpm} type="number" min={20} max={300}
    onSave={v => onUpdate('bpm', v)} />
  <KeyPicker value={p.key} onSave={v => onUpdate('key', v)} />
  <EditableCell label="Time" value={p.timeSignature} type="text"
    onSave={v => onUpdate('timeSignature', v)} />
  <div><div className="lbl">Tracks</div><div className="val">{p.trackCount ?? '—'}</div></div>
</div>
```

`onUpdate` already calls `updateProjectField` + `onProjectUpdated`, so no new wiring needed.

---

## Out of scope

- Validating key format server-side
- Undo / history of manual overrides
- Distinguishing auto-detected vs. manually-set values in the UI
