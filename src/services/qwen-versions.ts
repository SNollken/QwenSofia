import type { Page } from "playwright";

/**
 * Qwen Web and the Aliyun Baxia anti-bot SDK are both published as versioned
 * builds: the client is served from `/qwen-web/<version>/` and the SDK from
 * `/baxia/<version>/`. The same literals are sent as the `version` and `bx-v`
 * headers, so keeping them in sync with the live frontend avoids stale-build
 * rejections. Detection is best-effort: it never throws and falls back to the
 * last known good values.
 */
export const QWEN_WEB_VERSION_FALLBACK = "0.3.26";
export const QWEN_BX_VERSION_FALLBACK = "2.5.37";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

interface DetectSpec {
  /** Version embedded in an asset path. */
  assetRe: RegExp;
  /** Version keyed as `version=1.2.3` (cookies, inline JSON, query strings). */
  keyRe: RegExp;
  /** Dotted paths on `window` that may hold the version directly. */
  globals: string[];
}

const WEB_SPEC: DetectSpec = {
  assetRe: /(?:qwen-web|qwen-chat-fe)\/(\d+\.\d+\.\d+)/,
  keyRe: /[a-z0-9_-]*version["']?\s*[:=]\s*["']?(\d+\.\d+\.\d+)/i,
  globals: ["__qwen_version", "qwenVersion"],
};

const BX_SPEC: DetectSpec = {
  assetRe: /\/baxia\/(\d+\.\d+\.\d+)/,
  keyRe: /(?:__bxv|bx-v|bxv)["']?\s*[:=]\s*["']?(\d+\.\d+\.\d+)/i,
  globals: ["__bxv", "baxiaCommon.version"],
};

let detectedWebVersion: string | null = null;
let detectedBxVersion: string | null = null;

/** Current `version` header value, or the pinned fallback. */
export function getQwenWebVersion(): string {
  return detectedWebVersion ?? QWEN_WEB_VERSION_FALLBACK;
}

/** Current `bx-v` header value, or the pinned fallback. */
export function getBxVersion(): string {
  return detectedBxVersion ?? QWEN_BX_VERSION_FALLBACK;
}

/** Stores versions observed on live traffic; malformed values are ignored. */
export function rememberQwenVersions(versions: {
  webVersion?: string | null;
  bxVersion?: string | null;
}): void {
  if (versions.webVersion && SEMVER_RE.test(versions.webVersion)) {
    detectedWebVersion = versions.webVersion;
  }
  if (versions.bxVersion && SEMVER_RE.test(versions.bxVersion)) {
    detectedBxVersion = versions.bxVersion;
  }
}

/**
 * Reads one version from the loaded page: window globals first (cheap and
 * authoritative), then meta tags, script/link URLs, resource timings,
 * cookies and finally the raw markup.
 */
function readFromPage(page: Page, spec: DetectSpec): Promise<string | null> {
  return page
    .evaluate(
      ({ assetSource, keySource, globals }) => {
        const whole = /^\d+\.\d+\.\d+$/;
        const asset = new RegExp(assetSource);
        const keyed = new RegExp(keySource, "i");
        const at = (path: string): unknown =>
          path
            .split(".")
            .reduce<unknown>(
              (target, key) =>
                target == null ? target : (target as Record<string, unknown>)[key],
              window,
            );

        const candidates: unknown[] = [
          ...globals.map(at),
          ...Array.from(document.querySelectorAll("meta")).map((el) =>
            el.getAttribute("content"),
          ),
          ...Array.from(document.querySelectorAll("script[src], link[href]")).map(
            (el) => el.getAttribute("src") || el.getAttribute("href"),
          ),
          ...(typeof performance !== "undefined" && performance.getEntriesByType
            ? performance.getEntriesByType("resource").map((entry) => entry.name)
            : []),
          document.cookie,
          document.documentElement?.outerHTML,
        ];

        for (const value of candidates) {
          if (typeof value !== "string" || !value) continue;
          if (whole.test(value)) return value;
          const match = value.match(asset) ?? value.match(keyed);
          if (match) return match[1];
        }
        return null;
      },
      {
        assetSource: spec.assetRe.source,
        keySource: spec.keyRe.source,
        globals: spec.globals,
      },
    )
    .then((value) =>
      typeof value === "string" && SEMVER_RE.test(value) ? value : null,
    )
    .catch(() => null);
}

/** Detects the Qwen Web build version; returns null when unavailable. */
export function detectQwenWebVersion(page: Page): Promise<string | null> {
  return readFromPage(page, WEB_SPEC);
}

/**
 * Detects the Baxia SDK version. The SDK script loads asynchronously, so poll
 * until it appears or `timeoutMs` elapses.
 */
export async function detectBaxiaVersion(
  page: Page,
  timeoutMs = 8000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const version = await readFromPage(page, BX_SPEC);
    if (version) return version;
    if (Date.now() >= deadline) return null;
    await Promise.resolve()
      .then(() => page.waitForTimeout(250))
      .catch(() => {});
  }
}

/**
 * Detects both versions from the live page, caches what it finds and returns
 * the effective values (detected or fallback).
 */
export async function refreshQwenVersions(
  page: Page,
): Promise<{ webVersion: string; bxVersion: string }> {
  const [webVersion, bxVersion] = await Promise.all([
    detectQwenWebVersion(page),
    detectBaxiaVersion(page),
  ]);

  rememberQwenVersions({ webVersion, bxVersion });

  return { webVersion: getQwenWebVersion(), bxVersion: getBxVersion() };
}
