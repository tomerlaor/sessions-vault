// Importing scripts/ai-cli.ts runs its top-level parseArgs() and main(): both
// are safe under vitest because process.argv in the test worker carries no
// CLI-style flags (so parseArgs sees an empty argv, and main() just prints
// help and returns, since there's no command to run).
import { describe, it, expect, beforeAll } from "vitest";

describe("ai-cli --reasoning", () => {
  beforeAll(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  it("resolveLyricsReasoning maps the CLI flag onto AIConfig.lyricsReasoning", async () => {
    const { resolveLyricsReasoning } = await import("../scripts/ai-cli");
    expect(resolveLyricsReasoning("off")).toBe("off");
    expect(resolveLyricsReasoning("default")).toBe("provider-default");
    expect(resolveLyricsReasoning("minimal")).toBe("minimal");
    expect(resolveLyricsReasoning("low")).toBe("low");
    expect(resolveLyricsReasoning("medium")).toBe("medium");
    expect(resolveLyricsReasoning("high")).toBe("high");
  });

  it("buildConfig defaults lyricsReasoning to 'off' when --reasoning is omitted", async () => {
    const { buildConfig } = await import("../scripts/ai-cli");
    expect(buildConfig().lyricsReasoning).toBe("off");
  });
});
