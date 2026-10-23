# OpenRouter Provider — Design / Plan (US-004)

## Current state
- `AIProvider` = `openai | anthropic | ollama | lmstudio` (`src/types/index.ts:28`).
- `buildProvider()` in `src/lib/ai.ts` switches on provider; local providers reuse `createOpenAI` with a `baseURL`.
- API keys are stored per provider in the OS keychain as `ai.apikey.<provider>` (`src/db/queries/ai.ts`), so a new provider needs no Rust change.
- Settings UI: `PROVIDERS` list + model dropdown in `src/components/settings/SettingsModal.tsx` (~L256-270).
- Lyrics AI (`src/lib/lyrics-ai.ts`) and Tab Agent (`TabAgentModal.tsx`) go through `src/lib/ai.ts`.

## Approach (recommended)
OpenRouter is OpenAI-compatible, so reuse `@ai-sdk/openai` with `baseURL: "https://openrouter.ai/api/v1"`. No new dependency.
Alternative: `@openrouter/ai-sdk-provider` — adds first-class support for provider routing/reasoning options, but is an extra dependency. Start with the OpenAI-compatible route; revisit if needed.

## Steps
1. **Types:** add `"openrouter"` to `AIProvider`.
2. **Provider:** add `openrouter` case in `buildProvider()` using `createOpenAI({ baseURL, apiKey, headers: { "HTTP-Referer": <app url>, "X-Title": "Sessions" } })`. Default model e.g. `anthropic/claude-haiku-4.5`.
3. **Model list:** fetch `GET https://openrouter.ai/api/v1/models` (no key required), cache in memory, show the full list (300+) in a searchable combobox (filter by name/ID); allow free-text model ID fallback when offline.
4. **Per-feature models:** add optional `lyricsModel` and `tabAgentModel` to `AIConfig` (stored in the same JSON config row, no key changes). `LyricsAiOverlay` and `TabAgentModal` (both call `getAIConfig()`) use their override, falling back to `model`. Settings shows two extra pickers under the default one.
5. **Settings UI:** add provider option, key field (reuses keychain path), searchable model picker.
6. **Tauri/CSP:** allow `https://openrouter.ai` in the CSP / HTTP capability config (check `src-tauri/tauri.conf.json`).
7. **Structured output:** `generateObject` relies on JSON-mode/tool support, which varies per OpenRouter model — surface a clear error and consider `provider: { require_parameters: true }`.
8. **Tests:** unit-test `buildProvider` for openrouter; test the model-list parser; manual test of lyrics suggestion + tab agent + invalid key.

## Decisions
- Full model list with search (no curated shortlist).
- No pricing/context-length display.
- Per-feature model choice: yes (Lyrics AI, Tab Agent).
