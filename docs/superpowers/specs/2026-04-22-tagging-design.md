# Tagging — Design Spec

**Date:** 2026-04-22
**Status:** Approved

---

## Overview

Add the ability to add and remove tags on a project from the Overview tab. Tags are stored globally (one `tags` table) and linked to projects via `project_tags`. Interaction style: inline type-to-filter with instant create, no modals or popovers.

---

## Data layer

### Bug fix: `removeTag`

Current implementation ignores `tagId` and deletes all tags for the project. Fix to target the specific `(projectId, tagId)` row in `project_tags`.

```ts
// before (broken)
await db.delete(projectTags).where(eq(projectTags.projectId, projectId));

// after
await db
  .delete(projectTags)
  .where(
    and(eq(projectTags.projectId, projectId), eq(projectTags.tagId, tagId)),
  );
```

### Color assignment

A fixed palette of 10 distinct colors. When creating a new tag, pick the next color by cycling through the palette based on the total number of existing tags. No user color picker.

```ts
const TAG_COLORS = [
  "#ff7a45",
  "#ffcc66",
  "#5cd18b",
  "#0ea5e9",
  "#a98bff",
  "#ff5a5a",
  "#34d399",
  "#f472b6",
  "#fb923c",
  "#818cf8",
];
```

---

## `TagInput` component

**Location:** `src/components/shared/TagInput.tsx`

**Props:**

```ts
interface Props {
  projectId: string;
  projectTags: string[]; // tag names already on this project
  allTags: Tag[]; // all tags in the library
  onChange: () => void; // called after any add/remove to trigger reload
}
```

**States:**

- Closed: renders existing tag chips (with ×) + the "+ add tag" chip
- Open: the "+ add tag" chip is replaced by a text `<input>` + dropdown

**Dropdown logic:**

1. Filter `allTags` by whether `name.includes(query)` (case-insensitive)
2. Exclude tags already on the project
3. If query is non-empty and no exact name match exists, prepend a "Create '#query'" row
4. Arrow keys navigate; Enter selects highlighted row; Escape closes

**Add flow:**

- Select existing tag → `assignTag(projectId, tagId)` → `onChange()`
- Select "Create" → `createTag(name, nextColor(allTags.length))` → `assignTag` → `onChange()`

**Remove flow:**

- Click × on chip → `removeTag(projectId, tagId)` → `onChange()`

**Keyboard / focus:**

- Input auto-focuses when opened
- Blur (clicking outside) closes the dropdown without action

---

## Wiring changes

### `OverviewTab`

Add `projectId: string`, `allTags: Tag[]`, and `onTagChange: () => void` to props. Replace the static tag chip row with `<TagInput projectId={...} allTags={...} projectTags={p.tags ?? []} onChange={onTagChange} />`.

### `DetailPanel`

Add `allTags: Tag[]` prop. Pass `project.id`, `allTags`, and `onProjectUpdated` down to `OverviewTab` as `onTagChange`.

### `App.tsx`

Add `allTags` to `DetailPanel` props. After any tag change, `reload()` re-fetches projects (which include their tags), so no extra state management is needed.

---

## Out of scope

- Tag color editing
- Tag renaming or deletion
- Bulk tagging multiple projects at once
- Tag ordering
