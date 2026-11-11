import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import {
  detectBaxiaVersion,
  detectQwenWebVersion,
  getBxVersion,
  getQwenWebVersion,
  refreshQwenVersions,
  rememberQwenVersions,
} from "../services/qwen-versions.ts";

type Attrs = Record<string, string>;

const element = (attrs: Attrs) => ({ getAttribute: (name: string) => attrs[name] ?? null });

interface FakeDom {
  metas?: Attrs[];
  scripts?: string[];
  links?: string[];
  cookie?: string;
  html?: string;
  globals?: Record<string, unknown>;
  resources?: string[];
}

/** Installs a minimal DOM on globalThis so the page-side callback really runs. */
async function withFakeDom<T>(dom: FakeDom, run: () => Promise<T>): Promise<T> {
  const g = globalThis as any;
  const saved = { window: g.window, document: g.document, performance: g.performance };

  g.window = dom.globals ?? {};
  g.document = {
    querySelectorAll: (selector: string) =>
      selector === "meta"
        ? (dom.metas ?? []).map(element)
        : [
            ...(dom.scripts ?? []).map((src) => element({ src })),
            ...(dom.links ?? []).map((href) => element({ href })),
          ],
    documentElement: { outerHTML: dom.html ?? "" },
    cookie: dom.cookie ?? "",
  };
  g.performance = {
    getEntriesByType: () => (dom.resources ?? []).map((name) => ({ name })),
  };

  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  }
}

function fakePage(overrides: Partial<Record<"evaluate" | "waitForTimeout", unknown>> = {}): Page {
  return {
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
    waitForTimeout: async () => {},
    ...overrides,
  } as unknown as Page;
}

test("falls back to the pinned versions when nothing is detected", () => {
  assert.equal(getQwenWebVersion(), "0.3.26");
  assert.equal(getBxVersion(), "2.5.37");
});

test("rememberQwenVersions ignores malformed values", () => {
  rememberQwenVersions({ webVersion: "0.3", bxVersion: "bx-2.5.37" });
  rememberQwenVersions({ webVersion: "", bxVersion: null });

  assert.equal(getQwenWebVersion(), "0.3.26");
  assert.equal(getBxVersion(), "2.5.37");
});

test("rememberQwenVersions caches versions seen on live traffic", () => {
  rememberQwenVersions({ webVersion: "0.3.24", bxVersion: "2.5.36" });

  assert.equal(getQwenWebVersion(), "0.3.24");
  assert.equal(getBxVersion(), "2.5.36");
});

test("detectQwenWebVersion reads the version from a meta tag", async () => {
  const version = await withFakeDom(
    { metas: [{ name: "qwen-web-version", content: "0.3.30" }] },
    () => detectQwenWebVersion(fakePage()),
  );

  assert.equal(version, "0.3.30");
});

test("detectQwenWebVersion reads the version from asset URLs and cookies", async () => {
  const fromScript = await withFakeDom(
    { scripts: ["https://assets.alicdn.com/g/qwenweb/qwen-web/0.3.31/js/main.js"] },
    () => detectQwenWebVersion(fakePage()),
  );
  const fromResources = await withFakeDom(
    { resources: ["https://cdn.example.com/qwen-web/0.3.32/index.css"] },
    () => detectQwenWebVersion(fakePage()),
  );
  const fromCookie = await withFakeDom(
    { cookie: "cna=abc; qwen_version=0.3.33; theme=dark" },
    () => detectQwenWebVersion(fakePage()),
  );

  assert.equal(fromScript, "0.3.31");
  assert.equal(fromResources, "0.3.32");
  assert.equal(fromCookie, "0.3.33");
});

test("detectQwenWebVersion reads the version from a window global", async () => {
  const version = await withFakeDom(
    { globals: { __qwen_version: "0.3.34" } },
    () => detectQwenWebVersion(fakePage()),
  );

  assert.equal(version, "0.3.34");
});

test("detectQwenWebVersion returns null instead of throwing", async () => {
  const empty = await withFakeDom({}, () => detectQwenWebVersion(fakePage()));
  const broken = await withFakeDom({}, () =>
    detectQwenWebVersion(
      fakePage({
        evaluate: async () => {
          throw new Error("page closed");
        },
      }),
    ),
  );

  assert.equal(empty, null);
  assert.equal(broken, null);
});

test("detectBaxiaVersion reads window.__bxv and baxiaCommon.version", async () => {
  const fromGlobal = await withFakeDom(
    { globals: { __bxv: "2.5.38" } },
    () => detectBaxiaVersion(fakePage(), 0),
  );
  const fromSdk = await withFakeDom(
    { globals: { baxiaCommon: { version: "2.5.39" } } },
    () => detectBaxiaVersion(fakePage(), 0),
  );
  const fromScript = await withFakeDom(
    { scripts: ["https://g.alicdn.com/sd/baxia/2.5.40/baxiaCommon.js"] },
    () => detectBaxiaVersion(fakePage(), 0),
  );

  assert.equal(fromGlobal, "2.5.38");
  assert.equal(fromSdk, "2.5.39");
  assert.equal(fromScript, "2.5.40");
});

test("detectBaxiaVersion polls until the timeout and then gives up", async () => {
  const waits: number[] = [];
  const version = await withFakeDom({}, () =>
    detectBaxiaVersion(
      fakePage({
        waitForTimeout: async (ms: number) => {
          waits.push(ms);
        },
      }),
      30,
    ),
  );

  assert.equal(version, null);
  assert.ok(waits.length >= 1, "should have waited at least once for the SDK script");
});

test("refreshQwenVersions detects both versions and returns the effective values", async () => {
  const dom: FakeDom = {
    scripts: [
      "https://assets.alicdn.com/g/qwenweb/qwen-web/0.3.35/js/main.js",
      "https://g.alicdn.com/sd/baxia/2.5.41/baxiaCommon.js",
    ],
  };

  const refreshed = await withFakeDom(dom, () => refreshQwenVersions(fakePage()));

  assert.deepEqual(refreshed, { webVersion: "0.3.35", bxVersion: "2.5.41" });
  assert.equal(getQwenWebVersion(), "0.3.35");
  assert.equal(getBxVersion(), "2.5.41");
});
