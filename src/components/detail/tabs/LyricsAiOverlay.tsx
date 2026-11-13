import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  getAIConfigFor,
  getAIConfigWithoutKey,
  setAIConfig,
} from "../../../db/queries/ai";
import {
  getLyricsAIConfig,
  setLyricsAIConfig,
  getStyleProfile,
  logStyleEvent,
  updateEventTag,
  countAcceptedEvents,
  getRecentAccepted,
  upsertStyleProfile,
} from "../../../db/queries/lyrics-ai";
import { generateStyleSummary, resolveFeatureConfig } from "../../../lib/ai";
import {
  buildLyricsSuggestionPrompt,
  buildLyricsPopupPrompt,
  buildNextWordOptionsPrompt,
  determineSuggestionMode,
  normalizeNextWord,
  normalizeNextWordOptions,
} from "../../../lib/lyrics-ai";
import {
  LruCache,
  createDebouncer,
  shouldRunRequest,
  isBlankContext,
  requestStreamSuggestion,
  requestNextWordOptions,
  requestPopupSuggestions,
  type RunSignature,
  type NextWordOptionsResult,
  type PopupSuggestionsResult,
} from "../../../lib/lyrics-ai-request";
import {
  gateLyricsAi,
  isLocalProvider,
  pickLocalProvider,
  switchToLocalAIConfig,
} from "../../../lib/lyrics-privacy";
import LyricsCloudConsentModal from "../../shared/LyricsCloudConsentModal";
import type {
  Project,
  AIConfig,
  AIProvider,
  LyricsAIConfig,
  LyricSuggestionMode,
  LyricRejectionTag,
} from "../../../types";

// Shared across overlay instances (e.g. switching lyrics tabs/projects) so
// retyping or undoing to a previously-seen prompt never re-hits the AI.
const streamCache = new LruCache<string, string>(50);
const nextWordCache = new LruCache<string, NextWordOptionsResult>(50);
const popupCache = new LruCache<string, PopupSuggestionsResult>(50);

export interface LyricsAiOverlayHandle {
  hasSuggestion: () => boolean;
  acceptSuggestion: () => void;
  dismissSuggestion: () => void;
}

interface PopupItem {
  mode: LyricSuggestionMode;
  text: string;
  // Shown instead of the mode name, e.g. "rhyme" for a rhyming next-word option.
  label?: string;
}

interface Props {
  draft: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  project: Project;
  onInsert: (text: string, mode: LyricSuggestionMode) => void;
}

const DEFAULT_CFG: LyricsAIConfig = {
  enabled: false,
  mode: "inline",
  enabledModes: ["completion"],
  feedbackMode: "minimal",
};

const BACKDROP_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "12.5px",
  lineHeight: "1.55",
  letterSpacing: "-0.005em",
  padding: "10px 12px",
  whiteSpace: "pre-wrap",
  wordWrap: "break-word",
  width: "100%",
  boxSizing: "border-box",
};

const REJECTION_TAGS: LyricRejectionTag[] = [
  "too_cheesy",
  "good_rhyme",
  "wrong_vibe",
  "other",
];

const LyricsAiOverlay = forwardRef<LyricsAiOverlayHandle, Props>(
  (
    { draft, selectionStart, selectionEnd, scrollTop, project, onInsert },
    ref,
  ) => {
    const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
    const [consentProvider, setConsentProvider] = useState<AIProvider | null>(
      null,
    );
    const [cfg, setCfg] = useState<LyricsAIConfig>(DEFAULT_CFG);
    const [globalProfile, setGlobalProfile] = useState<string | null>(null);
    const [projectProfile, setProjectProfile] = useState<string | null>(null);

    const [ghostText, setGhostText] = useState("");
    const [currentSuggestion, setCurrentSuggestion] = useState<string | null>(
      null,
    );
    const [currentMode, setCurrentMode] = useState<LyricSuggestionMode | null>(
      null,
    );
    const [status, setStatus] = useState<
      "idle" | "loading" | "streaming" | "ready" | "error"
    >("idle");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [popupItems, setPopupItems] = useState<PopupItem[]>([]);

    const [tagChipVisible, setTagChipVisible] = useState(false);
    const [pendingTagEventId, setPendingTagEventId] = useState<string | null>(
      null,
    );

    const debouncer = useRef(createDebouncer(800)).current;
    const abortControllerRef = useRef<AbortController | null>(null);
    const lastSignatureRef = useRef<RunSignature | null>(null);
    const tagTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );

    // The AI config includes the API key, which is read from the OS keychain
    // (and may prompt for the password), so only load it once consent (if
    // needed) is in place.
    const loadAiConfig = useCallback(() => {
      getAIConfigFor("lyrics").then(setAiConfig);
    }, []);

    // The single gate before any cloud request: never read the keychain or
    // call the AI provider while opted out, disabled, or lacking consent.
    const checkAndMaybeLoad = useCallback(
      (lyricsCfg: LyricsAIConfig) => {
        if (project.aiOptOut || !lyricsCfg.enabled) {
          setConsentProvider(null);
          setAiConfig(null);
          return;
        }
        getAIConfigWithoutKey().then((cfgNoKey) => {
          const gate = gateLyricsAi(
            project.aiOptOut,
            lyricsCfg,
            cfgNoKey?.provider ?? null,
          );
          if (gate.status === "needs_consent") {
            setConsentProvider(gate.provider);
            setAiConfig(null);
            return;
          }
          setConsentProvider(null);
          if (!cfgNoKey) {
            setAiConfig(null);
          } else if (isLocalProvider(cfgNoKey.provider)) {
            // Local providers need no API key — skip the keychain entirely.
            setAiConfig(resolveFeatureConfig(cfgNoKey, "lyrics"));
          } else {
            loadAiConfig();
          }
        });
      },
      [project.aiOptOut, loadAiConfig],
    );

    useEffect(() => {
      getLyricsAIConfig().then((lyricsAI) => {
        setCfg(lyricsAI);
        checkAndMaybeLoad(lyricsAI);
      });

      const onCfgChange = (e: Event) => {
        const next = (e as CustomEvent<LyricsAIConfig>).detail;
        setCfg(next);
        checkAndMaybeLoad(next);
      };
      window.addEventListener("lyrics-ai-config-changed", onCfgChange);

      return () => {
        clearTimeout(tagTimerRef.current);
        window.removeEventListener("lyrics-ai-config-changed", onCfgChange);
      };
    }, [checkAndMaybeLoad]);

    const handleConsentUseCloud = useCallback(async () => {
      const next = { ...cfg, cloudConsentAt: Date.now() };
      await setLyricsAIConfig(next);
      setCfg(next);
      window.dispatchEvent(
        new CustomEvent("lyrics-ai-config-changed", { detail: next }),
      );
    }, [cfg]);

    const handleConsentSwitchToLocal = useCallback(async () => {
      const current = (await getAIConfigWithoutKey()) ?? {
        provider: "ollama" as AIProvider,
        apiKey: "",
        baseUrl: "",
        model: "",
      };
      const nextAiCfg = switchToLocalAIConfig(current);
      await setAIConfig(nextAiCfg);
      setConsentProvider(null);
      setAiConfig(nextAiCfg);
      window.dispatchEvent(
        new CustomEvent("lyrics-ai-config-changed", { detail: cfg }),
      );
    }, [cfg]);

    useEffect(() => {
      Promise.all([
        getStyleProfile("global"),
        getStyleProfile(project.id),
      ]).then(([g, p]) => {
        setGlobalProfile(g);
        setProjectProfile(p);
      });
    }, [project.id]);

    // "Clear this song's memory" (Lyrics tab) clears the DB row directly —
    // refresh the in-memory profile this overlay is holding so it stops
    // being used in prompts without waiting for a project switch.
    useEffect(() => {
      const onMemoryCleared = (e: Event) => {
        const { projectId } = (e as CustomEvent<{ projectId: string }>).detail;
        if (projectId === project.id) setProjectProfile(null);
      };
      window.addEventListener("lyrics-style-memory-cleared", onMemoryCleared);
      return () =>
        window.removeEventListener(
          "lyrics-style-memory-cleared",
          onMemoryCleared,
        );
    }, [project.id]);

    useEffect(() => {
      if (!cfg.enabled || !aiConfig || project.aiOptOut) {
        setGhostText("");
        setCurrentSuggestion(null);
        setStatus("idle");
        return;
      }

      debouncer.schedule(() => {
        void runRequest();
      });

      async function runRequest() {
        if (!aiConfig) return;
        const mode = determineSuggestionMode(
          draft,
          selectionStart,
          selectionEnd,
          cfg.enabledModes,
        );
        if (!mode) return;

        const textBeforeCursor = draft.slice(0, selectionStart);
        const lineStart = textBeforeCursor.lastIndexOf("\n") + 1;
        const lineEnd = draft.indexOf("\n", selectionStart);
        const currentLine = draft.slice(
          lineStart,
          lineEnd === -1 ? undefined : lineEnd,
        );
        const lineTextBeforeCursor = draft.slice(lineStart, selectionStart);

        if (isBlankContext(draft)) {
          setGhostText("");
          setCurrentSuggestion(null);
          setPopupItems([]);
          setStatus("idle");
          return;
        }

        const signature: RunSignature = { mode, currentLine, draft };
        if (!shouldRunRequest(lastSignatureRef.current, signature)) {
          // Nothing meaningful changed since the last completed request
          // (e.g. the cursor just moved) — leave whatever is showing as-is.
          return;
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;
        const { signal } = controller;
        const isCurrent = () => abortControllerRef.current === controller;

        setCurrentMode(mode);

        const recentAccepted = await getRecentAccepted(project.id, 5);
        if (!isCurrent()) return;

        const baseInput = {
          lyrics: draft,
          currentLine,
          textBeforeCursor: lineTextBeforeCursor,
          selectionStart,
          selectionEnd,
          title: project.title,
          bpm: project.bpm,
          key: project.key,
          timeSignature: project.timeSignature,
          globalProfile,
          projectProfile,
          recentAccepted,
          songContext: project.lyricsContext,
        };

        if (mode === "next_word" && cfg.mode === "inline") {
          // In popup display mode the popup prompt already lists several
          // next_word options alongside the other modes.
          // Several candidates (one rhyming), shown in the suggestion list.
          setGhostText("");
          setCurrentSuggestion(null);
          setPopupItems([]);
          setStatus("loading");
          try {
            const { system, prompt } = buildNextWordOptionsPrompt(baseInput);
            const result = await requestNextWordOptions({
              aiConfig,
              system,
              prompt,
              signal,
              cache: nextWordCache,
            });
            if (!isCurrent()) return;
            if (result.status === "aborted") {
              setStatus("idle");
              return;
            }
            const options = normalizeNextWordOptions(
              result.value.options,
              lineTextBeforeCursor,
            );
            if (options.length === 0) {
              setStatus("idle");
              return;
            }
            setPopupItems(
              options.map((o) => ({
                mode: "next_word",
                text: o.text,
                label: o.kind === "rhyme" ? "rhyme" : undefined,
              })),
            );
            // Tab accepts the first (most natural) option.
            setCurrentSuggestion(options[0].text);
            setStatus("ready");
            lastSignatureRef.current = signature;
          } catch (err) {
            if (isCurrent()) {
              setErrorMsg(
                err instanceof Error ? err.message : "AI request failed",
              );
              setStatus("error");
              setTimeout(() => {
                setStatus("idle");
                setErrorMsg(null);
              }, 6000);
            }
          }
        } else if (cfg.mode === "popup") {
          setStatus("loading");
          try {
            const { system, prompt } = buildLyricsPopupPrompt({
              ...baseInput,
              enabledModes: cfg.enabledModes,
            });
            const result = await requestPopupSuggestions({
              aiConfig,
              system,
              prompt,
              signal,
              cache: popupCache,
            });
            if (!isCurrent()) return;
            if (result.status === "aborted") {
              setStatus("idle");
              return;
            }
            setPopupItems(
              result.value.suggestions.map((s) =>
                s.mode === "next_word"
                  ? {
                      ...s,
                      text: normalizeNextWord(s.text, lineTextBeforeCursor),
                    }
                  : s,
              ),
            );
            setStatus("ready");
            lastSignatureRef.current = signature;
          } catch (err) {
            if (isCurrent()) {
              setErrorMsg(
                err instanceof Error ? err.message : "AI request failed",
              );
              setStatus("error");
              setTimeout(() => {
                setStatus("idle");
                setErrorMsg(null);
              }, 6000);
            }
          }
        } else if (mode !== "next_word") {
          setGhostText("");
          setCurrentSuggestion(null);
          setStatus("loading");
          try {
            const { system, prompt } = buildLyricsSuggestionPrompt({
              ...baseInput,
              mode,
            });
            const result = await requestStreamSuggestion({
              aiConfig,
              cacheMode: mode,
              system,
              prompt,
              signal,
              cache: streamCache,
              onToken: (accumulated) => {
                if (!isCurrent()) return;
                setGhostText(accumulated);
                setStatus("streaming");
              },
            });
            if (!isCurrent()) return;
            if (result.status === "aborted") {
              setGhostText("");
              setStatus("idle");
              return;
            }
            if (result.value) {
              setCurrentSuggestion(result.value);
              setStatus("ready");
              lastSignatureRef.current = signature;
            } else {
              setStatus("idle");
            }
          } catch (err) {
            if (isCurrent()) {
              setGhostText("");
              setErrorMsg(
                err instanceof Error ? err.message : "AI request failed",
              );
              setStatus("error");
              setTimeout(() => {
                setStatus("idle");
                setErrorMsg(null);
              }, 6000);
            }
          }
        }
      }

      return () => {
        debouncer.cancel();
        abortControllerRef.current?.abort();
      };
    }, [
      draft,
      selectionStart,
      selectionEnd,
      cfg,
      aiConfig,
      project.id,
      project.title,
      project.bpm,
      project.key,
      project.timeSignature,
      project.lyricsContext,
      project.aiOptOut,
      globalProfile,
      projectProfile,
      debouncer,
    ]);

    const triggerProfileRegenIfNeeded = useCallback(
      async (scopeId: string | null) => {
        if (!aiConfig) return;
        const count = await countAcceptedEvents(scopeId);
        if (count > 0 && count % 5 === 0) {
          const recent = await getRecentAccepted(scopeId, 20);
          const summary = await generateStyleSummary(aiConfig, recent);
          const profileId = scopeId ?? "global";
          await upsertStyleProfile(profileId, summary);
          if (scopeId === null) setGlobalProfile(summary);
          else setProjectProfile(summary);
        }
      },
      [aiConfig],
    );

    const handleAccept = useCallback(
      async (text: string, mode: LyricSuggestionMode) => {
        onInsert(text, mode);
        setGhostText("");
        setCurrentSuggestion(null);
        setStatus("idle");
        setPopupItems([]);

        await Promise.all([
          logStyleEvent({
            projectId: null,
            suggestionText: text,
            mode,
            accepted: true,
            tag: null,
          }),
          logStyleEvent({
            projectId: project.id,
            suggestionText: text,
            mode,
            accepted: true,
            tag: null,
          }),
        ]);

        await triggerProfileRegenIfNeeded(null);
        await triggerProfileRegenIfNeeded(project.id);
      },
      [onInsert, project.id, triggerProfileRegenIfNeeded],
    );

    const handleReject = useCallback(
      async (text: string, mode: LyricSuggestionMode) => {
        setGhostText("");
        setCurrentSuggestion(null);
        setStatus("idle");
        setPopupItems([]);

        if (cfg.feedbackMode === "tagged") {
          const [eventId] = await Promise.all([
            logStyleEvent({
              projectId: project.id,
              suggestionText: text,
              mode,
              accepted: false,
              tag: null,
            }),
            logStyleEvent({
              projectId: null,
              suggestionText: text,
              mode,
              accepted: false,
              tag: null,
            }),
          ]);
          setPendingTagEventId(eventId);
          setTagChipVisible(true);
          clearTimeout(tagTimerRef.current);
          tagTimerRef.current = setTimeout(() => {
            setTagChipVisible(false);
            setPendingTagEventId(null);
          }, 3000);
        }
      },
      [cfg.feedbackMode, project.id],
    );

    useImperativeHandle(
      ref,
      () => ({
        hasSuggestion: () =>
          (cfg.mode === "inline" || currentMode === "next_word") &&
          !!currentSuggestion,
        acceptSuggestion: () => {
          if (currentSuggestion && currentMode)
            handleAccept(currentSuggestion, currentMode);
        },
        dismissSuggestion: () => {
          if (currentSuggestion && currentMode) {
            handleReject(currentSuggestion, currentMode);
          } else {
            setGhostText("");
            setCurrentSuggestion(null);
            setStatus("idle");
          }
        },
      }),
      [cfg.mode, currentSuggestion, currentMode, handleAccept, handleReject],
    );

    if (!cfg.enabled) return null;

    if (project.aiOptOut) {
      return (
        <div
          style={{
            position: "absolute",
            right: 10,
            top: 8,
            fontSize: 11,
            color: "var(--text-3)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          AI off for this song
        </div>
      );
    }

    if (consentProvider) {
      return (
        <LyricsCloudConsentModal
          provider={consentProvider}
          localProvider={pickLocalProvider(consentProvider)}
          onUseCloud={handleConsentUseCloud}
          onSwitchToLocal={handleConsentSwitchToLocal}
        />
      );
    }

    if (!aiConfig) {
      return (
        <div
          style={{
            position: "absolute",
            right: 10,
            top: 8,
            fontSize: 11,
            color: "var(--text-3)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          AI suggestions on — configure a provider in Settings
        </div>
      );
    }

    return (
      <>
        {cfg.mode === "inline" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <div
              style={{
                ...BACKDROP_STYLE,
                transform: `translateY(-${scrollTop}px)`,
                color: "transparent",
              }}
            >
              {draft}
              {status === "loading" && !ghostText && (
                <span style={{ color: "var(--accent)", opacity: 0.4 }}>…</span>
              )}
              {ghostText && (
                <span style={{ color: "var(--accent)", opacity: 0.4 }}>
                  {ghostText}
                </span>
              )}
            </div>
          </div>
        )}

        {(cfg.mode === "popup" || currentMode === "next_word") &&
          (status === "loading" || status === "ready") && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "100%",
                marginTop: 4,
                zIndex: 20,
                background: "var(--bg-2)",
                border: "1px solid var(--line-2)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                overflow: "hidden",
              }}
            >
              {status === "loading" && (
                <div
                  style={{
                    padding: "10px 12px",
                    fontSize: 12,
                    color: "var(--text-3)",
                  }}
                >
                  Thinking…
                </div>
              )}
              {status === "ready" &&
                popupItems.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => handleAccept(item.text, item.mode)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "9px 12px",
                      textAlign: "left",
                      borderBottom:
                        i < popupItems.length - 1
                          ? "1px solid var(--line)"
                          : "none",
                      background: "transparent",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--accent)",
                        flexShrink: 0,
                        paddingTop: 2,
                      }}
                    >
                      {item.label ?? item.mode.replace("_", " ")}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: "var(--text-0)",
                        lineHeight: 1.5,
                      }}
                    >
                      {item.text}
                    </span>
                  </button>
                ))}
            </div>
          )}

        {status === "error" && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              padding: "5px 10px",
              fontSize: 11,
              color: "#ff7a7a",
              background: "rgba(255,60,60,0.08)",
              borderBottom: "1px solid rgba(255,60,60,0.2)",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            ⚠ AI error: {errorMsg ?? "request failed"} — check Settings → AI
            Assistant
          </div>
        )}

        {tagChipVisible && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: -34,
              display: "flex",
              gap: 5,
              padding: "5px 12px",
              background: "var(--bg-1)",
              borderTop: "1px solid var(--line)",
              zIndex: 20,
            }}
          >
            {REJECTION_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={async () => {
                  if (pendingTagEventId)
                    await updateEventTag(pendingTagEventId, tag);
                  setTagChipVisible(false);
                  setPendingTagEventId(null);
                }}
                style={{
                  fontSize: 10.5,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--bg-2)",
                  border: "1px solid var(--line-2)",
                  color: "var(--text-2)",
                }}
              >
                {tag.replace("_", " ")}
              </button>
            ))}
          </div>
        )}
      </>
    );
  },
);

LyricsAiOverlay.displayName = "LyricsAiOverlay";
export default LyricsAiOverlay;
