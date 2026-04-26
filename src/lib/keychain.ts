import { invoke } from '@tauri-apps/api/core'

export async function storeSecret(key: string, value: string): Promise<void> {
  await invoke('store_secret', { key, value })
}

export async function getSecret(key: string): Promise<string | null> {
  return invoke<string | null>('get_secret', { key })
}

export async function deleteSecret(key: string): Promise<void> {
  await invoke('delete_secret', { key })
}
