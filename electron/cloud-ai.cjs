"use strict";

/**
 * Optional, opt-in cloud text analysis, routed through the Electron main
 * process.
 *
 * Two deliberate properties keep this within the app's privacy promise:
 *   1. It runs only when the user explicitly turns it on and provides their own
 *      API key (bring-your-own-key). Nothing here is reached automatically.
 *   2. Only transcript *text* ever leaves the machine — never the recording.
 *
 * The key is stored encrypted at rest with Electron safeStorage (same as the
 * biometric enrollment), never in the renderer. All network egress happens here
 * in the main process via net.fetch, so the renderer CSP stays fully closed.
 */

const { app, net, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const KEY_FILE = "cloud-ai-key.clb";
const KEY_HEADER = Buffer.from("CLB1");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-5";
const SUPPORTED_PROVIDERS = new Set(["anthropic"]);

function keyPath() {
  return path.join(app.getPath("userData"), KEY_FILE);
}

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("os-encryption-unavailable");
  }
}

async function saveCloudKey(payload) {
  const provider = payload && typeof payload.provider === "string" ? payload.provider : "anthropic";
  const key = payload && typeof payload.key === "string" ? payload.key.trim() : "";
  if (!SUPPORTED_PROVIDERS.has(provider)) throw new Error("unsupported-provider");
  // Anthropic keys are long; reject obvious typos without pinning an exact format.
  if (key.length < 20) throw new Error("invalid-key");

  assertEncryptionAvailable();
  const encrypted = safeStorage.encryptString(JSON.stringify({ provider, key }));
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(keyPath(), Buffer.concat([KEY_HEADER, encrypted]));
  return { hasKey: true, provider };
}

async function loadCloudKey() {
  const buffer = await fs.readFile(keyPath());
  if (!buffer.subarray(0, KEY_HEADER.length).equals(KEY_HEADER)) {
    throw new Error("unsupported-key-file");
  }
  assertEncryptionAvailable();
  const parsed = JSON.parse(safeStorage.decryptString(buffer.subarray(KEY_HEADER.length)));
  if (!parsed || typeof parsed.key !== "string") throw new Error("invalid-key-file");
  return { provider: typeof parsed.provider === "string" ? parsed.provider : "anthropic", key: parsed.key };
}

async function cloudKeyStatus() {
  try {
    const stored = await loadCloudKey();
    return { hasKey: true, provider: stored.provider };
  } catch (error) {
    if (error && error.code === "ENOENT") return { hasKey: false };
    // A decrypt/format failure means the stored key is unusable — report absent.
    return { hasKey: false, error: error && error.message ? error.message : "unknown" };
  }
}

async function clearCloudKey() {
  try {
    await fs.unlink(keyPath());
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  return { hasKey: false };
}

/**
 * One Claude completion. The renderer owns the prompt and the parsing/guardrails
 * (it reuses the same validated corrector as the local path); this function is a
 * thin, auditable transport that adds the stored key and returns plain text.
 */
async function cloudComplete(payload) {
  const stored = await loadCloudKey();
  if (stored.provider !== "anthropic") throw new Error("unsupported-provider");

  const system = typeof payload?.system === "string" ? payload.system : "";
  const user = typeof payload?.user === "string" ? payload.user : "";
  if (!user.trim()) throw new Error("empty-request");
  const model = typeof payload?.model === "string" && payload.model.trim() ? payload.model.trim() : DEFAULT_MODEL;
  const maxTokens = Number.isFinite(payload?.maxTokens) ? Math.min(Math.max(Math.round(payload.maxTokens), 256), 16000) : 4096;

  const body = {
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: user }]
  };

  let response;
  try {
    response = await net.fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": stored.key,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("cloud-network-error");
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      detail = "";
    }
    if (response.status === 401 || response.status === 403) throw new Error("cloud-auth-error");
    if (response.status === 429) throw new Error("cloud-rate-limited");
    throw new Error(`cloud-http-${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const data = await response.json();
  if (data && data.stop_reason === "refusal") throw new Error("cloud-refused");
  const text = Array.isArray(data?.content)
    ? data.content.filter((block) => block && block.type === "text").map((block) => block.text).join("")
    : "";
  if (!text.trim()) throw new Error("cloud-empty-response");
  return { text, model };
}

module.exports = { saveCloudKey, cloudKeyStatus, clearCloudKey, cloudComplete };
