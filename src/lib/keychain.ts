import { invoke } from "@tauri-apps/api/core";

export async function storeSecret(key: string, value: string): Promise<void> {
  await invoke("store_secret", { key, value });
}

export async function getSecret(key: string): Promise<string | null> {
  return invoke<string | null>("get_secret", { key });
}

// Checks for a stored secret without reading it, so it never prompts.
export async function secretExists(key: string): Promise<boolean> {
  return invoke<boolean>("secret_exists", { key });
}

export async function deleteSecret(key: string): Promise<void> {
  await invoke("delete_secret", { key });
}
