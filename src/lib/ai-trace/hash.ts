// Keyed hash so an exported trace can't be dictionary-matched back to a
// lyric, while identical (system, prompt) pairs still dedupe locally. Uses
// WebCrypto (globalThis.crypto.subtle) so it works unmodified in Node 20
// (the CLI/eval harness) and in the Tauri webview.
export async function hashPrompt(
  salt: string,
  system: string,
  prompt: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${system}\0${prompt}`),
  );
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}
