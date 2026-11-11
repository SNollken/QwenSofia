/*
 * File: token-refresh.ts
 * Project: QwenSofia
 *
 * Keeps the Qwen access token usable.
 *
 * The bearer token is a short-lived JWT (15 min) while headers, warm chats and
 * persisted sessions live much longer. A cached token that expires silently
 * turns every upstream call into "Unauthorized", so the token is renewed here
 * before use. Renewal is cheap: the `refresh_token` cookie from signin is
 * enough to mint a new access token, no interactive login required.
 */

import type { Page } from "playwright";
import {
  getAccountHeaderCache,
  getCookies,
  getPageForAccount,
  setAccountAuthorization,
} from "./playwright.ts";

const REFRESH_URL = "https://chat.qwen.ai/api/v2/auths/refresh";
/** Renew slightly before the real expiry so a request in flight does not fail. */
const EXPIRY_SKEW_MS = 60_000;
/** Shorter strings are error bodies / placeholders, never real tokens. */
const MIN_TOKEN_LENGTH = 20;

const cacheKey = (accountId?: string) => accountId || "global";

function authorizationFor(accountId?: string): string | undefined {
  return getAccountHeaderCache(cacheKey(accountId))?.["authorization"];
}

function stripBearer(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, "");
}

/** Expiry (ms) of the JWT inside an `authorization` header, or null when unreadable. */
function tokenExpiryMs(authorization?: string | null): number | null {
  const token = authorization?.trim().match(/^Bearer\s+(.+)$/i)?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return null;

  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json?.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * True when the bearer token is expired or about to expire. Tokens without a
 * readable expiry are treated as valid so opaque tokens are never discarded.
 */
export function isBearerTokenExpired(
  authorization?: string | null,
  skewMs = EXPIRY_SKEW_MS,
): boolean {
  const expiry = tokenExpiryMs(authorization);
  return expiry !== null && expiry - skewMs <= Date.now();
}

/**
 * Forces a refresh of the Qwen access token from inside the page, so the
 * request carries the browser's own cookies and origin headers.
 */
async function refreshQwenAccessToken(page: Page): Promise<string | null> {
  try {
    const body = await page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) return null;
      try {
        return await response.json();
      } catch {
        return null;
      }
    }, REFRESH_URL);

    const payload = body as Record<string, any> | null;
    const token = payload?.access_token ?? payload?.data?.access_token ?? payload?.token;
    if (typeof token !== "string" || token.trim().length < MIN_TOKEN_LENGTH) return null;
    return stripBearer(token);
  } catch {
    return null;
  }
}

/**
 * Fallback renewal: reload the page so the web client refreshes the token
 * itself, then read it back from localStorage.
 */
async function renewAccessTokenViaPage(page: Page): Promise<string | null> {
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
  } catch {
    /* the token may already be in localStorage; try anyway */
  }

  try {
    const stored = await page.evaluate(
      () => localStorage.getItem("token") || localStorage.getItem("access_token"),
    );
    if (typeof stored !== "string" || stored.trim().length < MIN_TOKEN_LENGTH) return null;
    return stripBearer(stored);
  } catch {
    return null;
  }
}

/** Returns the bearer token held for the account, or null when missing/expired. */
export function getUsableBearerToken(accountId?: string): string | null {
  const authorization = authorizationFor(accountId);
  if (!authorization || isBearerTokenExpired(authorization)) return null;
  return authorization;
}

/** True when the account holds a bearer token that has expired. */
export function hasExpiredToken(accountId?: string): boolean {
  const authorization = authorizationFor(accountId);
  return !!authorization && isBearerTokenExpired(authorization);
}

/**
 * Renews the access token using the `refresh_token` cookie and caches the new
 * `authorization` header. Returns it, or null when a full signin is needed.
 */
export async function renewAccessToken(
  accountId?: string,
  page?: Page,
): Promise<string | null> {
  const target = page ?? (accountId ? getPageForAccount(accountId) : undefined);
  if (!target) return null;

  const token =
    (await refreshQwenAccessToken(target)) ?? (await renewAccessTokenViaPage(target));
  if (!token) return null;

  const authorization = `Bearer ${token}`;
  setAccountAuthorization(cacheKey(accountId), authorization);
  return authorization;
}

/** Ensures the account holds a usable token, renewing an expired one. */
export async function ensureUsableToken(
  accountId?: string,
  page?: Page,
): Promise<boolean> {
  if (getUsableBearerToken(accountId)) return true;

  if (await renewAccessToken(accountId, page)) {
    console.log(`[Token] Renewed expired Qwen access token for ${accountId || "global"}.`);
    return true;
  }

  return getUsableBearerToken(accountId) !== null;
}

/** Replaces the bearer token in a header set, keeping every other header. */
export function applyBearerToken(
  headers: Record<string, string>,
  authorization: string,
): Record<string, string> {
  return { ...headers, authorization };
}

/** Re-reads the cookie header from the live browser context for the account. */
export async function refreshCookieHeader(accountId?: string): Promise<string | null> {
  if (!accountId) return null;
  try {
    return (await getCookies(accountId)) || null;
  } catch {
    return null;
  }
}
