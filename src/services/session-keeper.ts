import { config } from "../core/config.ts";
import {
  closeIdlePlaywrightAccounts,
  getActivePlaywrightAccountIds,
  getPageForAccount,
  keepAlivePlaywrightAccount,
} from "./playwright.ts";
import { humanDelay, sleep } from "./human-behavior.ts";
import { getAccountRequestCount } from "../core/account-concurrency.ts";
import { getAccountCooldownInfo } from "../core/account-manager.ts";
import { ensureUsableToken, hasExpiredToken } from "./token-refresh.ts";

/** Minimum gap between token refresh attempts for the same account. */
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const lastTokenRefresh = new Map<string, number>();
const tokenRefreshApi = { hasExpiredToken, ensureUsableToken };
let tokenRefreshOverride: typeof tokenRefreshApi | null = null;

/** Test seam: swap the token-refresh module without touching its internals. */
export function _setTokenRefreshForTesting(
  api: typeof tokenRefreshApi | null,
): void {
  tokenRefreshOverride = api;
}

let running = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
let pendingCycle: Promise<void> | null = null;
let prepareMissingAccounts: (() => Promise<void>) | undefined;

/** Best-effort: never throws, so a token problem cannot stop the keeper. */
async function refreshTokenIfNeeded(accountId: string): Promise<void> {
  try {
    if (Date.now() - (lastTokenRefresh.get(accountId) ?? 0) < TOKEN_REFRESH_INTERVAL_MS) return;
    const api = tokenRefreshOverride ?? tokenRefreshApi;
    if (!api.hasExpiredToken(accountId)) return;
    lastTokenRefresh.set(accountId, Date.now());
    const refreshed = await api.ensureUsableToken(accountId, getPageForAccount(accountId));
    if (refreshed) {
      console.log(`[SessionKeeper] Token refreshed for ${accountId}`);
    } else {
      console.warn(`[SessionKeeper] Token refresh failed for ${accountId}`);
    }
  } catch (error) {
    console.warn(
      `[SessionKeeper] Token refresh error for ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function isSessionKeeperRunning(): boolean {
  return running;
}

async function performKeepAliveCycle(): Promise<void> {
    if (config.sessionKeeper.enabled) {
      await prepareMissingAccounts?.();
      const accountIds = getActivePlaywrightAccountIds();
      for (const accountId of accountIds) {
        if (getAccountRequestCount(accountId) > 0 || getAccountCooldownInfo(accountId)) continue;
        await refreshTokenIfNeeded(accountId);
        await keepAlivePlaywrightAccount(accountId).catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            !message.includes("Target closed") &&
            !message.includes("Page is closed")
          ) {
            console.warn(
              `[SessionKeeper] Keep-alive failed for ${accountId}: ${message}`,
            );
          }
        });
        await sleep(humanDelay(250, 900));
      }
    }

    const closed = await closeIdlePlaywrightAccounts(
      config.playwright.idleContextTtlMs,
    );
    if (closed > 0) {
      console.log(
        `🧹 [SessionKeeper] Closed ${closed} idle Playwright context(s)`,
      );
    }
}

function runKeepAliveCycle(): Promise<void> {
  if (pendingCycle) return pendingCycle;
  const cycle = performKeepAliveCycle();
  pendingCycle = cycle;
  const finished = () => {
    if (pendingCycle === cycle) pendingCycle = null;
  };
  void cycle.then(finished, finished);
  return cycle;
}

export function startSessionKeeper(options?: {
  prepareMissingAccounts?: () => Promise<void>;
}): void {
  const hasKeepAliveWork = config.sessionKeeper.enabled;
  const hasIdleCleanupWork = config.playwright.idleContextTtlMs > 0;
  if (running || (!hasKeepAliveWork && !hasIdleCleanupWork)) return;

  running = true;
  prepareMissingAccounts = options?.prepareMissingAccounts;
  intervalId = setInterval(() => {
    if (running) void runKeepAliveCycle().catch((error) => {
      console.warn("[SessionKeeper] Cycle failed:", error instanceof Error ? error.message : String(error));
    });
  }, config.sessionKeeper.intervalMs);
  intervalId.unref?.();

  if (config.sessionKeeper.enabled) {
    console.log(
      `💓 [SessionKeeper] Keep-alive enabled | interval=${config.sessionKeeper.intervalMs}ms idle=${config.sessionKeeper.idleMs}ms`,
    );
  }
}

export async function stopSessionKeeper(): Promise<void> {
  running = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  prepareMissingAccounts = undefined;
  await pendingCycle;
}

export async function runSessionKeeperOnceForTesting(): Promise<void> {
  await runKeepAliveCycle();
}
