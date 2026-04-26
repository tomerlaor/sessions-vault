import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  getBackups, insertBackup,
  getLocalConfig, setLocalConfig,
  getGDriveConfig, setGDriveConfig,
  getGDriveFolderConfig,
} from '../../../db/queries/backups'
import type { Project, BackupRecord, GDriveConfig } from '../../../types'

interface Props { project: Project }

interface BackupResult {
  provider: string
  destination: string
  sizeBytes: number
  checksum: string
}

interface GDriveTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

function fmt(secs: number) {
  return new Date(secs * 1000).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function fmtSize(bytes: number | null) {
  if (bytes == null) return '—'
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${(bytes / 1e6).toFixed(1)} MB`
}

function fileName(destination: string) {
  if (!destination) return null
  // Last path component works for both local paths and GDrive file IDs
  const part = destination.split(/[/\\]/).pop() ?? destination
  return part
}

function destinationLabel(b: BackupRecord) {
  if (!b.destination) return null
  // GDrive API returns a file ID (no slashes) — not a useful display path
  if (b.provider === 'gdrive' && !b.destination.includes('/') && !b.destination.includes('\\')) {
    return `Drive file ID: ${b.destination}`
  }
  return b.destination
}

export default function HistoryTab({ project: p }: Props) {
  const [backups, setBackups]       = useState<BackupRecord[]>([])
  const [localBusy, setLocalBusy]   = useState(false)
  const [gdriveBusy, setGdriveBusy] = useState(false)
  const [gdriveReady, setGdriveReady] = useState(false)
  const [localErr, setLocalErr]     = useState<string | null>(null)
  const [gdriveErr, setGdriveErr]   = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [bs, gc, gf] = await Promise.all([getBackups(p.id), getGDriveConfig(), getGDriveFolderConfig()])
    setBackups(bs)
    setGdriveReady(!!gc?.refreshToken || !!gf?.destination)
  }, [p.id])

  useEffect(() => { reload() }, [reload])

  // ── Local ────────────────────────────────────────────────────────────────

  const handleLocalBackup = useCallback(async () => {
    setLocalErr(null)
    let cfg = await getLocalConfig()
    if (!cfg?.destination) {
      const sel = await open({ directory: true, multiple: false, title: 'Select backup folder' })
      if (!sel) return
      const path = typeof sel === 'string' ? sel : (sel as { path: string }).path
      if (!path) return
      cfg = { destination: path }
      await setLocalConfig(cfg)
    }
    setLocalBusy(true)
    try {
      const result = await invoke<BackupResult>('backup_local', {
        filePath: p.filePath,
        title: p.title,
        destinationDir: cfg.destination,
      })
      await insertBackup({
        projectId: p.id, provider: 'local',
        destination: result.destination,
        snapshotAt: Math.floor(Date.now() / 1000),
        status: 'ok', sizeBytes: result.sizeBytes,
        checksum: result.checksum, errorMsg: null,
      })
      await reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLocalErr(msg)
      await insertBackup({
        projectId: p.id, provider: 'local', destination: cfg.destination,
        snapshotAt: Math.floor(Date.now() / 1000),
        status: 'failed', sizeBytes: null, checksum: null, errorMsg: msg,
      })
      await reload()
    } finally {
      setLocalBusy(false)
    }
  }, [p, reload])

  // ── Google Drive ─────────────────────────────────────────────────────────

  const ensureFreshToken = useCallback(async (cfg: GDriveConfig): Promise<string> => {
    const now = Math.floor(Date.now() / 1000)
    if (cfg.accessToken && cfg.tokenExpiry && cfg.tokenExpiry - now > 60) {
      return cfg.accessToken
    }
    if (!cfg.refreshToken) throw new Error('Not connected to Google Drive')
    const tokens = await invoke<GDriveTokens>('gdrive_refresh', {
      clientId: cfg.clientId, clientSecret: cfg.clientSecret,
      refreshToken: cfg.refreshToken,
    })
    const updated: GDriveConfig = {
      ...cfg, accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: Math.floor(Date.now() / 1000) + tokens.expiresIn,
    }
    await setGDriveConfig(updated)
    return tokens.accessToken
  }, [])

  const handleGDriveBackup = useCallback(async () => {
    setGdriveErr(null)
    const [folderCfg, apiCfg] = await Promise.all([getGDriveFolderConfig(), getGDriveConfig()])

    if (!folderCfg?.destination && !apiCfg?.refreshToken) {
      setGdriveErr('Google Drive not configured — open Settings to set it up.')
      return
    }

    setGdriveBusy(true)
    try {
      let result: BackupResult

      if (folderCfg?.destination) {
        // Folder method: same as local backup, just different destination
        result = await invoke<BackupResult>('backup_local', {
          filePath: p.filePath, title: p.title,
          destinationDir: folderCfg.destination,
        })
      } else {
        const accessToken = await ensureFreshToken(apiCfg!)
        result = await invoke<BackupResult>('backup_gdrive', {
          filePath: p.filePath, title: p.title, accessToken,
        })
      }

      await insertBackup({
        projectId: p.id, provider: 'gdrive',
        destination: result.destination,
        snapshotAt: Math.floor(Date.now() / 1000),
        status: 'ok', sizeBytes: result.sizeBytes,
        checksum: result.checksum, errorMsg: null,
      })
      await reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setGdriveErr(msg)
      await insertBackup({
        projectId: p.id, provider: 'gdrive', destination: '',
        snapshotAt: Math.floor(Date.now() / 1000),
        status: 'failed', sizeBytes: null, checksum: null, errorMsg: msg,
      })
      await reload()
    } finally {
      setGdriveBusy(false)
    }
  }, [p, ensureFreshToken, reload])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Local */}
        <button className="tb-btn" style={{ justifyContent: 'center', padding: '7px 12px' }}
          disabled={localBusy} onClick={handleLocalBackup}>
          {localBusy ? 'Backing up…' : 'Back Up Locally'}
        </button>
        {localErr && <div style={{ fontSize: 11, color: '#ff5a5a' }}>{localErr}</div>}

        {/* GDrive */}
        {gdriveReady ? (
          <>
            <button className="tb-btn primary" style={{ justifyContent: 'center', padding: '7px 12px' }}
              disabled={gdriveBusy} onClick={handleGDriveBackup}>
              {gdriveBusy ? 'Uploading…' : 'Back Up to Google Drive'}
            </button>
            {gdriveErr && <div style={{ fontSize: 11, color: '#ff5a5a' }}>{gdriveErr}</div>}
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '4px 2px' }}>
            Google Drive not connected — configure in <b style={{ color: 'var(--text-2)' }}>Settings</b>.
          </div>
        )}
      </div>

      {backups.length > 0 && (
        <>
          <div className="field-label">Backup history</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {backups.map(b => (
              <div key={b.id} style={{
                background: 'var(--bg-2)', border: '1px solid var(--line)',
                borderRadius: 5, padding: '8px 10px',
              }}>
                {/* Top row: status + provider + timestamp + size */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: b.status === 'ok' ? '#5cd18b' : '#ff5a5a',
                  }} />
                  <div style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, width: 42,
                    textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>
                    {b.provider === 'gdrive' ? 'Drive' : 'Local'}
                  </div>
                  <div style={{ flex: 1, fontSize: 11, color: 'var(--text-2)' }}>
                    {b.errorMsg ? (
                      <span style={{ color: '#ff5a5a' }}>{b.errorMsg}</span>
                    ) : fmt(b.snapshotAt)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                    {fmtSize(b.sizeBytes)}
                  </div>
                </div>

                {/* Bottom row: zip filename + full path */}
                {b.status === 'ok' && b.destination && (
                  <div style={{ marginTop: 5, paddingLeft: 15, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
                      fontWeight: 500 }}>
                      {fileName(b.destination)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={destinationLabel(b) ?? ''}>
                      {destinationLabel(b)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
