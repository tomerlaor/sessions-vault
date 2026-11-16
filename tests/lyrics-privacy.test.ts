import { describe, it, expect } from "vitest";
import {
  isCloudProvider,
  isLocalProvider,
  needsCloudConsent,
  pickLocalProvider,
  switchToLocalAIConfig,
  gateLyricsAi,
  gateCloudAi,
  resolveTabAgentLoad,
  aiBadgeLabel,
  cloudProviderLabel,
  localProviderLabel,
} from "../src/lib/lyrics-privacy";
import type { AIConfig, LyricsAIConfig } from "../src/types";

describe("isCloudProvider / isLocalProvider", () => {
  it("classifies cloud providers", () => {
    expect(isCloudProvider("openai")).toBe(true);
    expect(isCloudProvider("anthropic")).toBe(true);
    expect(isCloudProvider("openrouter")).toBe(true);
    expect(isCloudProvider("ollama")).toBe(false);
    expect(isCloudProvider("lmstudio")).toBe(false);
  });

  it("classifies local providers", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("lmstudio")).toBe(true);
    expect(isLocalProvider("openai")).toBe(false);
  });
});

describe("needsCloudConsent", () => {
  it("is false for local providers regardless of consent", () => {
    expect(needsCloudConsent("ollama", undefined)).toBe(false);
    expect(needsCloudConsent("lmstudio", undefined)).toBe(false);
  });

  it("is true for cloud providers with no consent timestamp", () => {
    expect(needsCloudConsent("openai", undefined)).toBe(true);
    expect(needsCloudConsent("anthropic", null)).toBe(true);
    expect(needsCloudConsent("openrouter", 0)).toBe(true);
  });

  it("is false once consent was granted", () => {
    expect(needsCloudConsent("openai", 1700000000000)).toBe(false);
  });

  it("is false when there's no provider configured yet", () => {
    expect(needsCloudConsent(null, undefined)).toBe(false);
    expect(needsCloudConsent(undefined, undefined)).toBe(false);
  });
});

describe("pickLocalProvider", () => {
  it("keeps the current provider when it's already local", () => {
    expect(pickLocalProvider("lmstudio")).toBe("lmstudio");
    expect(pickLocalProvider("ollama")).toBe("ollama");
  });

  it("defaults to ollama for a cloud provider", () => {
    expect(pickLocalProvider("openai")).toBe("ollama");
    expect(pickLocalProvider("anthropic")).toBe("ollama");
    expect(pickLocalProvider("openrouter")).toBe("ollama");
  });
});

describe("switchToLocalAIConfig", () => {
  const cloudCfg: AIConfig = {
    provider: "openai",
    apiKey: "sk-secret",
    baseUrl: "",
    model: "gpt-4.1-mini",
    lyricsModel: "gpt-4.1",
    tabAgentModel: "gpt-4.1",
  };

  it("switches provider, clears the key and per-feature model overrides", () => {
    const next = switchToLocalAIConfig(cloudCfg);
    expect(next.provider).toBe("ollama");
    expect(next.apiKey).toBe("");
    expect(next.model).toBe("");
    expect(next.lyricsModel).toBe("");
    expect(next.tabAgentModel).toBe("");
    expect(next.baseUrl).toBe("http://localhost:11434");
  });

  it("keeps an existing baseUrl instead of overwriting it", () => {
    const next = switchToLocalAIConfig({
      ...cloudCfg,
      baseUrl: "http://localhost:9999",
    });
    expect(next.baseUrl).toBe("http://localhost:9999");
  });
});

describe("gateLyricsAi", () => {
  const cfg: LyricsAIConfig = {
    enabled: true,
    mode: "inline",
    enabledModes: ["completion"],
    feedbackMode: "minimal",
  };

  it("opts out regardless of provider or consent", () => {
    expect(gateLyricsAi(true, cfg, "openai")).toEqual({ status: "opted_out" });
    expect(
      gateLyricsAi(true, { ...cfg, cloudConsentAt: Date.now() }, "ollama"),
    ).toEqual({ status: "opted_out" });
  });

  it("is disabled when the helper itself is off", () => {
    expect(gateLyricsAi(false, { ...cfg, enabled: false }, "openai")).toEqual({
      status: "disabled",
    });
  });

  it("needs consent for a cloud provider with no cloudConsentAt", () => {
    expect(gateLyricsAi(false, cfg, "openai")).toEqual({
      status: "needs_consent",
      provider: "openai",
    });
  });

  it("is ok for a local provider with no consent", () => {
    expect(gateLyricsAi(false, cfg, "ollama")).toEqual({ status: "ok" });
  });

  it("is ok for a cloud provider once consent was granted", () => {
    expect(
      gateLyricsAi(false, { ...cfg, cloudConsentAt: Date.now() }, "openai"),
    ).toEqual({ status: "ok" });
  });

  it("is ok when no provider is configured yet (nothing to gate)", () => {
    expect(gateLyricsAi(false, cfg, null)).toEqual({ status: "ok" });
  });
});

describe("gateCloudAi", () => {
  it("opt-out wins for tabAgent regardless of provider or consent", () => {
    expect(gateCloudAi("tabAgent", { aiOptOut: true }, "openai", {})).toEqual({
      status: "opted_out",
    });
    expect(
      gateCloudAi("tabAgent", { aiOptOut: true }, "ollama", {
        cloudConsentAt: Date.now(),
      }),
    ).toEqual({ status: "opted_out" });
  });

  it("needs consent for tabAgent with a cloud provider and no tabAgentCloudConsentAt", () => {
    expect(gateCloudAi("tabAgent", { aiOptOut: false }, "openai", {})).toEqual({
      status: "needs_consent",
      provider: "openai",
    });
  });

  it("is ok for tabAgent with a local provider and no consent", () => {
    expect(gateCloudAi("tabAgent", { aiOptOut: false }, "ollama", {})).toEqual({
      status: "ok",
    });
  });

  it("is ok for tabAgent with a cloud provider once tabAgentCloudConsentAt is set", () => {
    expect(
      gateCloudAi("tabAgent", { aiOptOut: false }, "openai", {
        cloudConsentAt: Date.now(),
      }),
    ).toEqual({ status: "ok" });
  });

  it("is ok for tabAgent when no provider is configured yet", () => {
    expect(gateCloudAi("tabAgent", { aiOptOut: false }, null, {})).toEqual({
      status: "ok",
    });
  });

  it("disabled only applies to the lyrics feature", () => {
    expect(
      gateCloudAi("lyrics", { aiOptOut: false }, "openai", {
        enabled: false,
        cloudConsentAt: Date.now(),
      }),
    ).toEqual({ status: "disabled" });
    expect(
      gateCloudAi("tabAgent", { aiOptOut: false }, "ollama", {
        enabled: false,
      }),
    ).toEqual({ status: "ok" });
  });

  it("a lyrics cloudConsentAt alone does not satisfy the tabAgent gate", () => {
    // LyricsAIConfig.cloudConsentAt lives on a different config object than
    // AIConfig.tabAgentCloudConsentAt — granting lyrics consent must not be
    // mistaken for tab agent consent.
    const lyricsCfg: LyricsAIConfig = {
      enabled: true,
      mode: "inline",
      enabledModes: ["completion"],
      feedbackMode: "minimal",
      cloudConsentAt: Date.now(),
    };
    expect(gateLyricsAi(false, lyricsCfg, "openai")).toEqual({
      status: "ok",
    });
    expect(
      gateCloudAi("tabAgent", { aiOptOut: false }, "openai", {
        cloudConsentAt: undefined,
      }),
    ).toEqual({ status: "needs_consent", provider: "openai" });
  });
});

describe("resolveTabAgentLoad", () => {
  it("opts out regardless of config", () => {
    expect(resolveTabAgentLoad({ aiOptOut: true }, null)).toEqual({
      kind: "opted_out",
    });
  });

  it("has no config when none is stored", () => {
    expect(resolveTabAgentLoad({ aiOptOut: false }, null)).toEqual({
      kind: "no_config",
    });
  });

  it("needs consent for a cloud provider with no tabAgentCloudConsentAt", () => {
    const cfg: AIConfig = {
      provider: "openai",
      apiKey: "",
      baseUrl: "",
      model: "",
    };
    expect(resolveTabAgentLoad({ aiOptOut: false }, cfg)).toEqual({
      kind: "needs_consent",
      provider: "openai",
    });
  });

  it("is ok and skips the keychain for a local provider", () => {
    const cfg: AIConfig = {
      provider: "ollama",
      apiKey: "",
      baseUrl: "",
      model: "",
    };
    expect(resolveTabAgentLoad({ aiOptOut: false }, cfg)).toEqual({
      kind: "ok",
      readKeychain: false,
    });
  });

  it("is ok and reads the keychain for a cloud provider with consent", () => {
    const cfg: AIConfig = {
      provider: "openai",
      apiKey: "",
      baseUrl: "",
      model: "",
      tabAgentCloudConsentAt: Date.now(),
    };
    expect(resolveTabAgentLoad({ aiOptOut: false }, cfg)).toEqual({
      kind: "ok",
      readKeychain: true,
    });
  });
});

describe("aiBadgeLabel", () => {
  it("returns null when no provider is configured", () => {
    expect(aiBadgeLabel(null)).toBeNull();
  });

  it("labels local providers generically", () => {
    expect(
      aiBadgeLabel({
        provider: "ollama",
        apiKey: "",
        baseUrl: "",
        model: "llama3",
      }),
    ).toBe("AI · Local");
    expect(
      aiBadgeLabel({
        provider: "lmstudio",
        apiKey: "",
        baseUrl: "",
        model: "local-model",
      }),
    ).toBe("AI · Local");
  });

  it("labels cloud providers with provider/model", () => {
    expect(
      aiBadgeLabel({
        provider: "openai",
        apiKey: "",
        baseUrl: "",
        model: "gpt-4.1-mini",
      }),
    ).toBe("AI · Cloud: openai/gpt-4.1-mini");
  });

  it("falls back to 'default' when no model is set", () => {
    expect(
      aiBadgeLabel({
        provider: "anthropic",
        apiKey: "",
        baseUrl: "",
        model: "",
      }),
    ).toBe("AI · Cloud: anthropic/default");
  });
});

describe("label helpers", () => {
  it("cloudProviderLabel", () => {
    expect(cloudProviderLabel("openai")).toBe("OpenAI");
    expect(cloudProviderLabel("anthropic")).toBe("Anthropic");
    expect(cloudProviderLabel("openrouter")).toBe("OpenRouter");
  });

  it("localProviderLabel", () => {
    expect(localProviderLabel("ollama")).toBe("Ollama");
    expect(localProviderLabel("lmstudio")).toBe("LM Studio");
  });
});
