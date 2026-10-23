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

---

### US-003: Add Custom String Lines and 4-Bar Default Grid

**User Story:**
As a music creator, I want to add extra string lines to the tab editor and have a 4-bar grid by default so that I can notate non-standard instruments and have enough space for a standard musical phrase without immediately needing to extend.

**Acceptance Criteria:**
- [ ] A new "Add Line" button appears in the tab grid footer alongside the existing "Extend" button
- [ ] Clicking "Add Line" shows an inline label input; confirming appends a new string row to the grid
- [ ] The new string row behaves identically to existing rows (clickable cells, fret/annotation placement)
- [ ] A new tab part starts with 4 bars (64 columns) by default instead of 2 bars

**Priority:** Medium
**Status:** Draft

---

### US-004: OpenRouter as an AI Provider

**User Story:**
As a music creator, I want to connect my OpenRouter API key and pick any model it offers so that I can use one account to access many AI models (for lyrics suggestions and the tab agent) without managing a separate key per vendor.

**Acceptance Criteria:**
- [ ] "OpenRouter" appears in the AI provider list in Settings alongside OpenAI, Anthropic, Ollama and LM Studio
- [ ] The OpenRouter API key is stored in the OS keychain, never in the SQLite DB or plain-text settings
- [ ] The model picker lists the full OpenRouter catalog (300+ models, fetched from OpenRouter) with a search box that filters by name or ID, and I can also type a model ID manually (e.g. `anthropic/claude-sonnet-4.6`)
- [ ] I can choose a different model for Lyrics AI and for the Tab Agent; each falls back to the default model if not set
- [ ] "Test connection" succeeds with a valid key and shows a clear error for an invalid key or unknown model
- [ ] Lyrics AI suggestions and the Tab Agent work with OpenRouter, including streaming
- [ ] If the model list cannot be fetched (offline), the app still works with a manually typed model ID

**Priority:** Medium
**Status:** Draft
