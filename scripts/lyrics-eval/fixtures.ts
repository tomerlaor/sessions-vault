// Loads and validates the eval fixture set from tests/fixtures/lyrics-eval/.
// Each file holds either a single fixture object or an array of them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EvalFixture } from "./types";

export const FIXTURES_DIR = fileURLToPath(
  new URL("../../tests/fixtures/lyrics-eval", import.meta.url),
);

const expectSchema = z.object({
  rhymeWith: z.string().optional(),
  syllables: z.tuple([z.number(), z.number()]).optional(),
  maxLines: z.number().int().positive().optional(),
  mustNotContain: z.array(z.string()).optional(),
});

const fixtureSchema = z.object({
  id: z.string().min(1),
  lang: z.enum(["en", "he"]),
  mode: z.enum(["next_line", "completion", "next_word", "alternative"]),
  lyrics: z.string(),
  cursor: z.number().int().min(0),
  songContext: z.string().optional(),
  bpm: z.number().optional(),
  key: z.string().optional(),
  expect: expectSchema,
});

export function loadFixtures(dir: string = FIXTURES_DIR): EvalFixture[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const fixtures: EvalFixture[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      const fixture = fixtureSchema.parse(item);
      if (fixture.cursor > fixture.lyrics.length) {
        throw new Error(
          `fixture ${fixture.id}: cursor is past the end of lyrics`,
        );
      }
      fixtures.push(fixture);
    }
  }
  return fixtures;
}

export interface FixtureSetSummary {
  total: number;
  byLang: Record<EvalFixture["lang"], number>;
  byMode: Record<EvalFixture["mode"], number>;
  duplicateIds: string[];
}

export function summarizeFixtures(fixtures: EvalFixture[]): FixtureSetSummary {
  const byLang: Record<EvalFixture["lang"], number> = { en: 0, he: 0 };
  const byMode: Record<EvalFixture["mode"], number> = {
    next_line: 0,
    completion: 0,
    next_word: 0,
    alternative: 0,
  };
  const seen = new Map<string, number>();
  for (const f of fixtures) {
    byLang[f.lang]++;
    byMode[f.mode]++;
    seen.set(f.id, (seen.get(f.id) ?? 0) + 1);
  }
  const duplicateIds = [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  return { total: fixtures.length, byLang, byMode, duplicateIds };
}
