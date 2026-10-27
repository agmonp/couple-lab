import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The phone app may use desktop code only through `@shared` (../src), and only
 * modules that run anywhere: no Electron, no Node built-ins, no MediaPipe, no
 * sherpa-onnx, no camera or microphone APIs. This walks every shared file the
 * phone imports, and everything those files import in turn.
 */
const MOBILE_SRC = path.resolve(__dirname, "../src");
const SHARED_ROOT = path.resolve(__dirname, "../../src");

const BANNED_MODULES = [/^electron(\/|$)/, /^node:/, /^@mediapipe\//, /^sherpa-onnx/, /^(fs|path|os|child_process|worker_threads|crypto|net|http|https|stream)$/];
const BANNED_APIS = [/\bgetUserMedia\b/, /\bmediaDevices\b/, /\bMediaRecorder\b/, /\bImageCapture\b/, /\bgetDisplayMedia\b/, /\bwindow\.electron\b/, /\brequire\(/];

function stripComments(code: string) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function importsOf(code: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)\s[^"'`]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
  for (const match of stripComments(code).matchAll(re)) specs.push(match[1] ?? match[2] ?? match[3]);
  return specs;
}

function resolveLocal(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Every shared file reachable from the given entry points, with what each one breaks. */
export function auditShared(entries: string[]) {
  const seen = new Set<string>();
  const problems: string[] = [];
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = fs.readFileSync(file, "utf8");
    const rel = path.relative(SHARED_ROOT, file);
    for (const spec of importsOf(code)) {
      if (spec.startsWith(".")) {
        const target = resolveLocal(file, spec);
        if (!target) problems.push(`${rel}: cannot resolve ${spec}`);
        else if (!target.startsWith(SHARED_ROOT)) problems.push(`${rel}: reaches outside src (${spec})`);
        else queue.push(target);
      } else if (BANNED_MODULES.some((re) => re.test(spec))) {
        problems.push(`${rel}: imports ${spec}`);
      }
    }
    const body = stripComments(code);
    for (const api of BANNED_APIS) if (api.test(body)) problems.push(`${rel}: uses ${api.source}`);
  }
  return { files: [...seen].map((f) => path.relative(SHARED_ROOT, f)).sort(), problems };
}

function sharedEntryPoints() {
  const entries = new Set<string>();
  for (const file of listFiles(MOBILE_SRC)) {
    for (const spec of importsOf(fs.readFileSync(file, "utf8"))) {
      if (!spec.startsWith("@shared/")) continue;
      const target = resolveLocal(path.join(SHARED_ROOT, "x"), `./${spec.slice("@shared/".length)}`);
      if (!target) throw new Error(`${path.relative(MOBILE_SRC, file)}: @shared import not found: ${spec}`);
      entries.add(target);
    }
  }
  return [...entries];
}

describe("shared modules stay portable", () => {
  it("the phone imports only clean shared modules", () => {
    const { files, problems } = auditShared(sharedEntryPoints());
    expect(files.length).toBeGreaterThan(3);
    expect(problems).toEqual([]);
  });

  it("the phone never reaches into ../src with a relative path", () => {
    for (const file of listFiles(MOBILE_SRC)) {
      for (const spec of importsOf(fs.readFileSync(file, "utf8"))) {
        if (spec.startsWith(".")) expect(path.resolve(path.dirname(file), spec).startsWith(MOBILE_SRC), `${file} -> ${spec}`).toBe(true);
      }
    }
  });

  it("the guard itself catches desktop-only modules", () => {
    expect(auditShared([path.join(SHARED_ROOT, "faceDescriptor.ts")]).problems.join("\n")).toMatch(/@mediapipe/);
    expect(auditShared([path.join(SHARED_ROOT, "App.tsx")]).problems.length).toBeGreaterThan(0);
  });
});
