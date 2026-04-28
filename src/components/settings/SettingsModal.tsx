import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  getLocalConfig, setLocalConfig,
  getGDriveConfig, setGDriveConfig,
  getGDriveFolderConfig, setGDriveFolderConfig,
} from '../../db/queries/backups'
import { getAIConfig, setAIConfig } from '../../db/queries/ai'
import { getLyricsAIConfig, setLyricsAIConfig, clearStyleMemory } from '../../db/queries/lyrics-ai'
import { testAIConnection, OPENAI_MODELS, ANTHROPIC_MODELS } from '../../lib/ai'
import type { LocalConfig, GDriveConfig, AIConfig, AIProvider, LyricsAIConfig } from '../../types'
import LyricsAiSettings from './LyricsAiSettings'
import Icon from '../shared/Icon'

interface GDriveTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

interface Props { onClose: () => void }

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 10 }}>
      {children}
    </div>
  )
}

function FolderRow({ path, onPick, label }: { path: string | null; onPick: () => void; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, fontSize: 11, color: path ? 'var(--text-2)' : 'var(--text-3)',
        fontFamily: 'var(--font-mono)', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {path ?? 'Not set'}
      </div>
      <button className="tb-btn" style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}
        onClick={onPick}>
        {path ? 'Change…' : label}
      </button>
    </div>
  )
}

export default function SettingsModal({ onClose }: Props) {
  const [localCfg, setLocalCfg]           = useState<LocalConfig | null>(null)
  const [gdriveFolderCfg, setGDriveFolderCfg] = useState<LocalConfig | null>(null)
  const [gdriveCfg, setGdriveCfg]         = useState<GDriveConfig | null>(null)
  const [clientId, setClientId]           = useState('')
  const [clientSecret, setClientSecret]   = useState('')
  const [connecting, setConnecting]       = useState(false)
  const [connectErr, setConnectErr]       = useState<string | null>(null)
  const [detectedPaths, setDetectedPaths] = useState<string[]>([])

  const [aiCfg, setAiCfg] = useState<AIConfig>({
    provider: 'openai', apiKey: '', baseUrl: '', model: '',
  })
  const [lyricsAICfg, setLyricsAICfgState] = useState<LyricsAIConfig>({
    enabled: false,
    mode: 'inline',
    enabledModes: ['completion'],
    feedbackMode: 'minimal',
  })
  const [aiTesting, setAiTesting]   = useState(false)
  const [aiTestResult, setAiTestResult] = useState<'ok' | 'error' | null>(null)
  const [aiTestErr, setAiTestErr]   = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      getLocalConfig(),
      getGDriveFolderConfig(),
      getGDriveConfig(),
      invoke<string[]>('detect_gdrive_paths'),
      getAIConfig(),
      getLyricsAIConfig(),
    ]).then(([lc, gf, gc, paths, ai, lyricsAI]) => {
      setLocalCfg(lc)
      setGDriveFolderCfg(gf)
      setGdriveCfg(gc)
      setDetectedPaths(paths)
      if (ai) setAiCfg(ai)
      setLyricsAICfgState(lyricsAI)
    })
  }, [])

  const pickFolder = useCallback(async (title: string): Promise<string | null> => {
    const sel = await open({ directory: true, multiple: false, title })
    if (!sel) return null
    return typeof sel === 'string' ? sel : (sel as { path: string }).path
  }, [])

  const handleLocalFolder = useCallback(async () => {
    const path = await pickFolder('Select local backup folder')
    if (!path) return
    const cfg: LocalConfig = { destination: path }
    await setLocalConfig(cfg)
    setLocalCfg(cfg)
  }, [pickFolder])

  const handleGDriveFolder = useCallback(async () => {
    const path = await pickFolder('Select your Google Drive synced folder')
    if (!path) return
    const cfg: LocalConfig = { destination: path }
    await setGDriveFolderConfig(cfg)
    setGDriveFolderCfg(cfg)
  }, [pickFolder])

  const handleConnect = useCallback(async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setConnectErr('Both fields are required')
      return
    }
    setConnectErr(null)
    setConnecting(true)
    try {
      const tokens = await invoke<GDriveTokens>('gdrive_auth', {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      })
      const cfg: GDriveConfig = {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry: Math.floor(Date.now() / 1000) + tokens.expiresIn,
      }
      await setGDriveConfig(cfg)
      setGdriveCfg(cfg)
      setClientId('')
      setClientSecret('')
    } catch (e) {
      setConnectErr(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
    }
  }, [clientId, clientSecret])

  const handleDisconnect = useCallback(async () => {
    const blank: GDriveConfig = {
      clientId: '', clientSecret: '',
      accessToken: null, refreshToken: null, tokenExpiry: null,
    }
    await setGDriveConfig(blank)
    setGdriveCfg(null)
  }, [])

  const handleSaveAI = useCallback(async (next: AIConfig) => {
    setAiCfg(next)
    setAiTestResult(null)
    await setAIConfig(next)
  }, [])

  const handleLyricsAIChange = useCallback(async (next: LyricsAIConfig) => {
    setLyricsAICfgState(next)
    await setLyricsAIConfig(next)
  }, [])

  const handleClearGlobalMemory = useCallback(async () => {
    await clearStyleMemory(null)
  }, [])

  const handleTestAI = useCallback(async () => {
    setAiTesting(true)
    setAiTestResult(null)
    setAiTestErr(null)
    try {
      await testAIConnection(aiCfg)
      setAiTestResult('ok')
    } catch (e) {
      setAiTestResult('error')
      setAiTestErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAiTesting(false)
    }
  }, [aiCfg])

  const PROVIDERS: { id: AIProvider; label: string }[] = [
    { id: 'openai',    label: 'OpenAI'     },
    { id: 'anthropic', label: 'Anthropic'  },
    { id: 'ollama',    label: 'Ollama'     },
    { id: 'lmstudio',  label: 'LM Studio'  },
  ]

  const isCloud  = aiCfg.provider === 'openai' || aiCfg.provider === 'anthropic'
  const isLocal  = aiCfg.provider === 'ollama' || aiCfg.provider === 'lmstudio'
  const modelOptions = aiCfg.provider === 'openai' ? OPENAI_MODELS : aiCfg.provider === 'anthropic' ? ANTHROPIC_MODELS : null
  const defaultBaseUrl = aiCfg.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        width: 460, maxHeight: '80vh',
        background: 'var(--bg-1)', border: '1px solid var(--line-2)',
        borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px',
          borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <Icon name="settings" size={14} style={{ marginRight: 8, color: 'var(--text-2)' }} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Settings</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', padding: 4 }}>
            <Icon name="x" size={12} />
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto' }}>

          {/* ── Local backup ── */}
          <section>
            <SectionTitle>Local backup</SectionTitle>
            <Hint>Backups are saved as ZIP files in this folder. Choose any local drive or external disk.</Hint>
            <FolderRow path={localCfg?.destination ?? null} onPick={handleLocalFolder} label="Choose folder…" />
          </section>

          <div style={{ height: 1, background: 'var(--line)' }} />

          {/* ── Google Drive ── */}
          <section>
            <SectionTitle>Google Drive</SectionTitle>

            {/* Option 1: Desktop app */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>
                Option 1 — Google Drive desktop app
              </div>
              <Hint>
                If you have <b>Google Drive for Desktop</b> installed, it syncs a local folder on your Mac.
                Pick that folder and backups will appear in your Drive automatically — no API setup needed.
              </Hint>

              {detectedPaths.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {detectedPaths.map(p => {
                    const isActive = gdriveFolderCfg?.destination === p
                    const email = p.match(/GoogleDrive-([^/]+)/)?.[1] ?? p
                    return (
                      <div key={p} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: isActive ? 'var(--bg-3)' : 'var(--bg-2)',
                        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--line)'}`,
                        borderRadius: 6, padding: '8px 10px',
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%',
                          background: '#5cd18b', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)' }}>
                            {email}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p}
                          </div>
                        </div>
                        {isActive ? (
                          <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>Active</span>
                        ) : (
                          <button className="tb-btn" style={{ fontSize: 11, padding: '3px 8px' }}
                            onClick={async () => {
                              const cfg = { destination: p }
                              await setGDriveFolderConfig(cfg)
                              setGDriveFolderCfg(cfg)
                            }}>
                            Use this
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8,
                  padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line)',
                  borderRadius: 6 }}>
                  No active Google Drive sync detected on this machine.
                </div>
              )}

              <FolderRow
                path={gdriveFolderCfg?.destination ?? null}
                onPick={handleGDriveFolder}
                label="Choose folder manually…"
              />
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase',
                letterSpacing: '0.06em' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>

            {/* Option 2: OAuth API */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>
                Option 2 — Google Drive API
              </div>
              <Hint>
                Uploads backups directly via the Google Drive API. Requires OAuth credentials from Google Cloud Console:
              </Hint>
              <ol style={{ margin: '0 0 12px 16px', padding: 0, fontSize: 11,
                color: 'var(--text-2)', lineHeight: 1.8 }}>
                <li>Go to <b>console.cloud.google.com</b> and create a project</li>
                <li>Enable the <b>Google Drive API</b> for that project</li>
                <li>Navigate to <b>APIs &amp; Services → Credentials</b></li>
                <li>Click <b>Create Credentials → OAuth client ID</b></li>
                <li>Choose <b>Desktop app</b> as the application type</li>
                <li>Copy the <b>Client ID</b> and <b>Client Secret</b> below</li>
              </ol>

              {gdriveCfg?.refreshToken ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%',
                    background: '#5cd18b', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-2)', flex: 1 }}>Connected</span>
                  <button className="tb-btn" style={{ fontSize: 11, padding: '4px 10px' }}
                    onClick={handleDisconnect}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    className="notes-area"
                    placeholder="Client ID"
                    value={clientId}
                    onChange={e => setClientId(e.target.value)}
                    style={{ fontSize: 11, padding: '6px 8px', height: 'auto',
                      resize: 'none', fontFamily: 'var(--font-mono)' }}
                  />
                  <input
                    className="notes-area"
                    placeholder="Client Secret"
                    type="password"
                    value={clientSecret}
                    onChange={e => setClientSecret(e.target.value)}
                    style={{ fontSize: 11, padding: '6px 8px', height: 'auto',
                      resize: 'none', fontFamily: 'var(--font-mono)' }}
                  />
                  {connectErr && (
                    <div style={{ fontSize: 11, color: '#ff5a5a' }}>{connectErr}</div>
                  )}
                  <button
                    className="tb-btn primary"
                    style={{ fontSize: 11, padding: '5px 12px', alignSelf: 'flex-start' }}
                    disabled={connecting}
                    onClick={handleConnect}>
                    {connecting ? 'Opening browser…' : 'Connect Google Drive'}
                  </button>
                </div>
              )}
            </div>
          </section>

          <div style={{ height: 1, background: 'var(--line)' }} />

          {/* ── AI Assistant ── */}
          <section>
            <SectionTitle>AI Assistant</SectionTitle>
            <Hint>Used by the Tab structure generator. Choose a provider and enter your credentials.</Hint>

            {/* Provider pills */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  className="tb-btn"
                  style={aiCfg.provider === p.id ? {
                    background: 'var(--accent)', borderColor: 'var(--accent)',
                    color: '#1a0a00', fontWeight: 600,
                  } : {}}
                  onClick={() => handleSaveAI({ ...aiCfg, provider: p.id, model: '' })}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* API key — cloud only */}
              {isCloud && (
                <input
                  className="notes-area"
                  type="password"
                  placeholder={aiCfg.provider === 'openai' ? 'OpenAI API key (sk-…)' : 'Anthropic API key (sk-ant-…)'}
                  value={aiCfg.apiKey}
                  onChange={e => handleSaveAI({ ...aiCfg, apiKey: e.target.value })}
                  style={{ fontSize: 11, padding: '6px 8px', height: 'auto', fontFamily: 'var(--font-mono)' }}
                />
              )}

              {/* Base URL — local only */}
              {isLocal && (
                <input
                  className="notes-area"
                  placeholder={defaultBaseUrl}
                  value={aiCfg.baseUrl}
                  onChange={e => handleSaveAI({ ...aiCfg, baseUrl: e.target.value })}
                  style={{ fontSize: 11, padding: '6px 8px', height: 'auto', fontFamily: 'var(--font-mono)' }}
                />
              )}

              {/* Model — editable with suggestions */}
              {modelOptions && <datalist id="ai-model-list">{modelOptions.map(m => <option key={m} value={m} />)}</datalist>}
              <input
                className="notes-area"
                list={modelOptions ? 'ai-model-list' : undefined}
                placeholder={modelOptions ? 'Model name or pick from list…' : 'Model name (e.g. llama3, mistral)'}
                value={aiCfg.model}
                onChange={e => handleSaveAI({ ...aiCfg, model: e.target.value })}
                style={{ fontSize: 11, padding: '6px 8px', height: 'auto', fontFamily: 'var(--font-mono)' }}
              />

              {/* Test row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                <button
                  className="tb-btn"
                  style={{ fontSize: 11, padding: '4px 12px' }}
                  disabled={aiTesting}
                  onClick={handleTestAI}
                >
                  {aiTesting ? 'Testing…' : 'Test connection'}
                </button>
                {aiTestResult === 'ok' && (
                  <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ Connected</span>
                )}
                {aiTestResult === 'error' && (
                  <span style={{ fontSize: 11, color: 'var(--red)' }} title={aiTestErr ?? ''}>
                    ✕ {aiTestErr ? aiTestErr.slice(0, 60) : 'Failed'}
                  </span>
                )}
              </div>
            </div>
          </section>

          <div style={{ height: 1, background: 'var(--line)' }} />

          {/* ── Lyrics AI ── */}
          <section>
            <SectionTitle>Lyrics AI</SectionTitle>
            <Hint>AI-powered autocomplete and brainstorm suggestions while writing lyrics. Uses your AI assistant settings above.</Hint>
            <LyricsAiSettings
              cfg={lyricsAICfg}
              onChange={handleLyricsAIChange}
              onClearGlobalMemory={handleClearGlobalMemory}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
