// Dev CLI for exercising the AI agents outside the app, using the same code
// paths as the UI (src/lib/ai.ts, src/lib/lyrics-ai.ts).
//
//   npm run ai -- help
import { parseArgs } from "node:util";
import {
  chatWithTabAgent,
  generateNextWordOptions,
  generatePopupSuggestions,
  generateTabStructure,
  streamLyricsSuggestion,
  testAIConnection,
} from "../src/lib/ai";
import {
  buildLyricsPopupPrompt,
  buildLyricsSuggestionPrompt,
  buildNextWordOptionsPrompt,
  normalizeNextWordOptions,
} from "../src/lib/lyrics-ai";
import type {
  AIConfig,
  AIProvider,
  Instrument,
  LyricSuggestionMode,
} from "../src/types";

const KEY_ENV: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const HELP = `DAW File Manager — AI agent CLI

Usage: npm run ai -- <command> [options]

Commands
  ping                     Check the provider/model/key work
  tab                      Tab Agent: generate a tab structure (JSON)
  tab-chat <message>       Tab Agent: free-form chat reply
  lyrics                   Lyrics helper: stream an inline suggestion
  lyrics-popup             Lyrics helper: structured popup suggestions

Connection (all commands)
  --provider <p>           openrouter (default) | openai | anthropic | ollama | lmstudio
  --model <id>             e.g. typesafe/jev-router   (or env AI_MODEL)
  --base-url <url>         for ollama / lmstudio
  API key is read from OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY.
  (Keys are taken from the environment only, so they don't end up in shell history.)

tab options
  --section <name>         default "Verse"
  --chords "<chords>"      default "Am F C G"
  --bars <n>               default 4
  --time <sig>             default 4/4
  --instruments <list>     comma list of guitar,bass,drums (default guitar)
  --style <text>           optional style note

lyrics / lyrics-popup options
  --lyrics <text>          lyrics so far ("\\n" for line breaks)
  --line <text>            the line being written (default: last line of --lyrics;
                           also what next_word/completion continue from)
  --mode <m>               completion | next_word (3+ options, one a rhyme) | alternative | next_line
  --context <text>         what the song is about: meaning, mood (the "Song context" field)
  --title / --bpm / --key / --time   song metadata

Examples
  OPENROUTER_API_KEY=sk-or-... npm run ai -- ping --model typesafe/jev-router
  npm run ai -- tab --section Chorus --chords "C G Am F" --instruments guitar,bass --model <id>
  npm run ai -- lyrics --lyrics "I walk alone\\nthrough the empty street" --mode next_line --model <id>
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    provider: { type: "string", default: "openrouter" },
    model: { type: "string" },
    "base-url": { type: "string" },
    section: { type: "string", default: "Verse" },
    chords: { type: "string", default: "Am F C G" },
    bars: { type: "string", default: "4" },
    time: { type: "string", default: "4/4" },
    instruments: { type: "string", default: "guitar" },
    style: { type: "string", default: "" },
    lyrics: { type: "string", default: "" },
    line: { type: "string" },
    mode: { type: "string", default: "completion" },
    context: { type: "string" },
    title: { type: "string", default: "Untitled" },
    bpm: { type: "string" },
    key: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function buildConfig(): AIConfig {
  const provider = values.provider as AIProvider;
  const local = provider === "ollama" || provider === "lmstudio";
  const keyVar = KEY_ENV[provider];
  const apiKey = keyVar ? (process.env[keyVar] ?? "") : "";
  if (!local && !apiKey) fail(`set ${keyVar} in your environment`);
  return {
    provider,
    apiKey,
    baseUrl: values["base-url"] ?? "",
    model: values.model ?? process.env.AI_MODEL ?? "",
  };
}

function lyricsInput() {
  const lyrics = values.lyrics.replace(/\\n/g, "\n");
  const lines = lyrics.split("\n");
  const currentLine = values.line ?? lines[lines.length - 1] ?? "";
  return {
    lyrics,
    currentLine,
    textBeforeCursor: currentLine,
    selectionStart: lyrics.length,
    selectionEnd: lyrics.length,
    title: values.title,
    bpm: values.bpm ? Number(values.bpm) : null,
    key: values.key ?? null,
    timeSignature: values.time,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
    songContext: values.context ?? null,
  };
}

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await run();
  } finally {
    console.error(`\n[${label}] ${Date.now() - t0}ms`);
  }
}

async function main() {
  const [command, ...rest] = positionals;
  if (!command || command === "help" || values.help) {
    console.log(HELP);
    return;
  }
  const cfg = buildConfig();
  console.error(`provider=${cfg.provider} model=${cfg.model || "(default)"}`);

  switch (command) {
    case "ping": {
      await timed("ping", () => testAIConnection(cfg));
      console.log("ok");
      break;
    }
    case "tab": {
      const instruments = values.instruments
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as Instrument[];
      const result = await timed("tab", () =>
        generateTabStructure(cfg, {
          sectionName: values.section,
          instruments,
          chords: values.chords,
          bars: Number(values.bars),
          timeSignature: values.time,
          styleNote: values.style,
        }),
      );
      for (const p of result.parts) {
        console.log(`\n--- ${p.name} (${p.instrument}) ---\n${p.content}`);
      }
      break;
    }
    case "tab-chat": {
      const message = rest.join(" ");
      if (!message) fail('usage: tab-chat "<message>"');
      const system =
        "You are a music tab structure assistant embedded in a DAW project manager. " +
        "If the user asks a question rather than requesting generation, answer concisely.";
      const reply = await timed("tab-chat", () =>
        chatWithTabAgent(cfg, system, [{ role: "user", content: message }]),
      );
      console.log(reply);
      break;
    }
    case "lyrics": {
      const mode = values.mode as LyricSuggestionMode;
      if (mode === "next_word") {
        // Several options, one rhyming — same flow and cleanup as the app.
        const input = lyricsInput();
        const { system, prompt } = buildNextWordOptionsPrompt(input);
        const result = await timed("lyrics next_word", () =>
          generateNextWordOptions(cfg, system, prompt),
        );
        const options = normalizeNextWordOptions(
          result.options,
          input.textBeforeCursor,
        );
        if (options.length < 3) {
          console.error(`warning: only ${options.length} option(s) returned`);
        }
        for (const o of options) {
          const tag = o.kind === "rhyme" ? "[rhyme]" : "       ";
          console.log(
            `${tag} ${JSON.stringify(o.text)}  →  ${input.textBeforeCursor}${o.text}`,
          );
        }
        break;
      }
      const { system, prompt } = buildLyricsSuggestionPrompt({
        ...lyricsInput(),
        mode,
      });
      await timed("lyrics", async () => {
        let received = 0;
        for await (const chunk of streamLyricsSuggestion(cfg, system, prompt)) {
          received += chunk.length;
          process.stdout.write(chunk);
        }
        process.stdout.write("\n");
        // streamText reports API errors to the console instead of throwing.
        if (received === 0)
          fail("the model returned no text (see error above)");
      });
      break;
    }
    case "lyrics-popup": {
      const { system, prompt } = buildLyricsPopupPrompt({
        ...lyricsInput(),
        enabledModes: ["completion", "alternative", "next_line"],
      });
      const result = await timed("lyrics-popup", () =>
        generatePopupSuggestions(cfg, system, prompt),
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      fail(`unknown command "${command}" — run: npm run ai -- help`);
  }
}

main().catch((e) => {
  console.error(`\nfailed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
