# Requirements

This file captures user stories for the project.
Stories are added via the `feature-to-user-story` skill.

---

### US-001: Edit Project Key (Root Note)

**User Story:**
As a music creator, I want to select the musical key (root note) of a project from a picklist so that I can accurately tag and later search/filter my projects by key.

**Acceptance Criteria:**

- [ ] The project detail view includes a "Key" field with a dropdown picklist
- [ ] The picklist contains exactly 12 options: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
- [ ] The selected key is saved to the project record in the local database
- [ ] The field displays the current key when reopening a project
- [ ] The field can be left empty (key unknown / not set)

**Priority:** Medium
**Status:** Draft

---

### US-002: Interactive Tab Editor with Fret Placement and Annotation Library

**User Story:**
As a music creator, I want to place fret numbers and musical annotations directly onto fixed-width string lines in a visual tab editor so that I can compose tablature intuitively without manually editing raw text.

**Acceptance Criteria:**
- [ ] Tab strings are rendered as a fixed-width grid of cells; the grid width never changes as fret numbers are placed
- [ ] Clicking a cell on a string line opens a small input to enter a fret number (0–24), which is placed at that column position
- [ ] Fret numbers placed in the same column across multiple strings are vertically aligned, representing a chord
- [ ] An annotation palette is always visible alongside the editor, listing all supported symbols (e.g. h, p, /, b, ~, x, etc.)
- [ ] Clicking an annotation in the palette and then a cell places that annotation symbol at that position
- [ ] The underlying tab content (stored as text) is kept in sync with every placement/removal action
- [ ] Existing text-based tab content is parsed and rendered correctly in the grid on load

**Priority:** High
**Status:** Draft
