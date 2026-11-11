import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import {
  applyBearerToken,
  ensureUsableToken,
  getUsableBearerToken,
  hasExpiredToken,
  refreshCookieHeader,
  renewAccessToken,
} from "../services/token-refresh.ts";
import { setAccountAuthorization, setCookieCacheForTesting } from "../services/playwright.ts";

function jwt(secondsFromNow: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

/**
 * Fake page: first evaluate call answers the refresh fetch, later calls answer
 * the localStorage read. `reloads` counts reload() invocations.
 */
function fakePage(
  refreshResult: unknown,
  storage: string | null = null,
  options: { refreshThrows?: boolean; storageThrows?: boolean } = {},
): Page & { calls: number; reloads: number } {
  let calls = 0;
  const page = {
    calls: 0,
    reloads: 0,
    async evaluate() {
      page.calls = ++calls;
      if (calls === 1) {
        if (options.refreshThrows) throw new Error("page crashed");
        return refreshResult;
      }
      if (options.storageThrows) throw new Error("no localStorage");
      return storage;
    },
    async reload() {
      page.reloads += 1;
    },
  };
  return page as unknown as Page & { calls: number; reloads: number };
}

test("expired cached token is not usable and is reported as expired", () => {
  setAccountAuthorization("tr-expired", `Bearer ${jwt(-120)}`);

  assert.equal(getUsableBearerToken("tr-expired"), null);
  assert.equal(hasExpiredToken("tr-expired"), true);
  assert.equal(getUsableBearerToken("tr-missing"), null);
  assert.equal(hasExpiredToken("tr-missing"), false);
});

test("renewAccessToken refreshes via the page fetch and caches the header", async () => {
  setAccountAuthorization("tr-renew", `Bearer ${jwt(-120)}`);
  assert.equal(hasExpiredToken("tr-renew"), true);

  const fresh = jwt(900);
  const page = fakePage({ data: { access_token: fresh } });

  const authorization = await renewAccessToken("tr-renew", page);

  assert.equal(authorization, `Bearer ${fresh}`);
  assert.equal(getUsableBearerToken("tr-renew"), `Bearer ${fresh}`);
  assert.equal(hasExpiredToken("tr-renew"), false);
  assert.equal(page.reloads, 0, "direct refresh should not need a reload");
});

test("renewAccessToken accepts a top-level token field and strips Bearer", async () => {
  const fresh = jwt(900);
  const authorization = await renewAccessToken(
    "tr-flat",
    fakePage({ token: `Bearer ${fresh}` }),
  );

  assert.equal(authorization, `Bearer ${fresh}`);
  assert.equal(getUsableBearerToken("tr-flat"), `Bearer ${fresh}`);
});

test("renewAccessToken falls back to reload + localStorage", async () => {
  const fresh = jwt(900);
  const page = fakePage(null, `Bearer ${fresh}`);

  const authorization = await renewAccessToken("tr-fallback", page);

  assert.equal(authorization, `Bearer ${fresh}`);
  assert.equal(page.reloads, 1);
  assert.equal(getUsableBearerToken("tr-fallback"), `Bearer ${fresh}`);
});

test("renewAccessToken returns null when both refresh paths fail", async () => {
  const page = fakePage({ error: "Invalid request header" }, null);

  assert.equal(await renewAccessToken("tr-fail", page), null);
  assert.equal(hasExpiredToken("tr-fail"), false);

  const crashy = fakePage(null, null, { refreshThrows: true, storageThrows: true });
  assert.equal(await renewAccessToken("tr-crash", crashy), null);
  assert.equal(crashy.reloads, 1);
});

test("renewAccessToken returns null without a page", async () => {
  assert.equal(await renewAccessToken(undefined), null);
  assert.equal(await renewAccessToken("tr-no-page"), null);
});

test("ensureUsableToken keeps a valid token and renews an expired one", async () => {
  setAccountAuthorization("tr-keep", `Bearer ${jwt(600)}`);
  assert.equal(await ensureUsableToken("tr-keep"), true);

  const failed = fakePage(null, null);
  assert.equal(await ensureUsableToken("tr-broken", failed), false);

  const fresh = jwt(900);
  assert.equal(
    await ensureUsableToken("tr-broken", fakePage({ access_token: fresh })),
    true,
  );
  assert.equal(getUsableBearerToken("tr-broken"), `Bearer ${fresh}`);
});

test("applyBearerToken replaces only the authorization header", () => {
  const headers = { cookie: "a=1", "bx-ua": "ua", authorization: "Bearer old" };
  const updated = applyBearerToken(headers, "Bearer new");

  assert.deepEqual(updated, { cookie: "a=1", "bx-ua": "ua", authorization: "Bearer new" });
  assert.equal(headers.authorization, "Bearer old", "input must not be mutated");
});

test("refreshCookieHeader reads the cookie jar and degrades to null", async () => {
  setCookieCacheForTesting("tr-cookie", "refresh_token=abc; other=1");

  assert.equal(await refreshCookieHeader("tr-cookie"), "refresh_token=abc; other=1");
  assert.equal(await refreshCookieHeader("tr-no-cookie"), null);
  assert.equal(await refreshCookieHeader(undefined), null);
});
