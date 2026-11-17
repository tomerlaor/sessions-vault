# AI agent CLI & lyrics eval harness

`npm run ai -- <command>` drives the same code paths as the in-app AI
assistant (`src/lib/ai.ts`, `src/lib/lyrics-ai.ts`) from the terminal, outside
the Tauri app. Run `npm run ai -- help` for the full command/option list.
Commands: `ping`, `tab`, `tab-chat`, `lyrics`, `lyrics-popup`, `eval`.

`eval` runs every fixture in `tests/fixtures/lyrics-eval/` through the
production prompt builders and model calls, `n` times each, and writes
`eval-results/<date>-<model>.json` and `.md` (gitignored — never commit
results, only fixtures/code). Pass `--rubric` to also write a blind CSV for
human scoring.

## Decisions models

Some OpenRouter models (e.g. `typesafe/jev-1.14`, `typesafe/jev-router`,
`~typesafe/jev-latest`) are **decisions models**: instead of writing text,
they answer typed yes/no, multiple-choice, or ordered-score questions about
some input, via `POST /api/alpha/decisions` rather than
`/chat/completions`. They can't generate a lyric suggestion on their own.

Every command above still works with one configured as the model — the app
and the CLI both run a "generate, then decide" pipeline instead of a plain
chat call:

1. A **generator** model (a normal chat model, default
   `anthropic/claude-haiku-4.5`) writes several candidate suggestions using
   the exact same prompts as the regular path.
2. The decisions model ranks them with a single `choice` question and the
   best candidate is returned.

If the ranking call fails for any reason other than a cancellation, the
pipeline falls back to the generator's own (unranked) top candidate rather
than failing the whole request.

CLI flags (all optional):

```
--generator <id>   chat model that writes the candidates (default anthropic/claude-haiku-4.5)
--candidates <k>    candidates generated per suggestion, 2-8 (default 4)
--decisions <m>     auto (default) | on | off — force how --model is classified
```

```bash
OPENROUTER_API_KEY=sk-or-... npm run ai -- eval --model typesafe/jev-1.14 \
  --generator anthropic/claude-haiku-4.5 --n 3 --rubric
```

The JSON/MD reports record generator and ranker timing, tokens, and cost
(the ranker's `usage.cost`, in USD) alongside the usual pass-rate stats, and
the results filename includes both models (`<ranker>+<generator>`).

On a decisions-model run the JSON also stores every pre-ranking candidate
for each trial, with the same automatic checks applied to each one. The
markdown report adds a **Picker accuracy** section that compares the
ranker's pick to the generator's first candidate, to a uniformly random
candidate, and to an oracle that always chooses a passing candidate when
one exists. "Picker accuracy" is the share of trials where the pick was a
best-scoring candidate (fewest failed checks; ties count). This is the
direct measure of whether the ranker adds value over just taking the
generator's first suggestion.

In the app, the same pipeline is configured in **Settings → AI Assistant**:
pick a decisions model as the Lyrics AI model (the picker tags decisions
models in its dropdown) to reveal the generator model and candidate-count
fields. "Decisions model detection" (`auto`/`on`/`off`) overrides automatic
detection when a model isn't in OpenRouter's known decisions list or catalog.
