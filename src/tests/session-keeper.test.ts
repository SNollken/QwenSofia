import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../core/config.ts";
import {
  _setTokenRefreshForTesting,
  isSessionKeeperRunning,
  runSessionKeeperOnceForTesting,
  startSessionKeeper,
  stopSessionKeeper,
} from "../services/session-keeper.ts";

async function runKeeperCycleWithTokens(): Promise<void> {
  const enabled = config.sessionKeeper.enabled;
  const idleTtl = config.playwright.idleContextTtlMs;
  config.sessionKeeper.enabled = true;
  config.playwright.idleContextTtlMs = 0; // keep fake pages alive across the cycle
  try {
    await runSessionKeeperOnceForTesting();
  } finally {
    config.sessionKeeper.enabled = enabled;
    config.playwright.idleContextTtlMs = idleTtl;
  }
}

function fakeAccountPage() {
  const calls = { goto: 0 };
  const page = {
    isClosed: () => false,
    // Off chat.qwen.ai forces keepAlive to navigate on every cycle.
    url: () => "https://example.com",
    goto: async () => {
      calls.goto++;
    },
    reload: async () => {},
    evaluate: async () => null,
  };
  return { page, calls };
}

test("session keeper starts and stops safely", () => {
  stopSessionKeeper();
  assert.equal(isSessionKeeperRunning(), false);

  startSessionKeeper();
  assert.equal(
    isSessionKeeperRunning(),
    config.sessionKeeper.enabled || config.playwright.idleContextTtlMs > 0,
  );

  stopSessionKeeper();
  assert.equal(isSessionKeeperRunning(), false);
});

test("session keeper one-shot cycle is safe without initialized accounts", async () => {
  stopSessionKeeper();
  await runSessionKeeperOnceForTesting();
  assert.equal(isSessionKeeperRunning(), false);
});

test("keepAlivePlaywrightAccount: updates lastAccountActivity on navigation timeout (Given / When / Then)", async () => {
  const {
    keepAlivePlaywrightAccount,
    _setAccountPageForTesting,
    _getLastAccountActivityForTesting,
    _setLastAccountActivityForTesting,
    _cleanupAccountForTesting,
  } = await import("../services/playwright.ts");

  // Given: an account with page initialized, idle beyond threshold
  const accountId = "test-tor-timeout-account";
  const staleTimestamp = Date.now() - config.sessionKeeper.idleMs - 50_000;
  _setAccountPageForTesting(accountId, {
    url: () => "https://other.domain.com", // triggers shouldNavigate
    isClosed: () => false,
    goto: async () => {
      throw new Error("page.goto: Timeout 15000ms exceeded.");
    },
  });
  _setLastAccountActivityForTesting(accountId, staleTimestamp);

  try {
    // When: keepAlivePlaywrightAccount runs and encounters a navigation timeout
    const result = await keepAlivePlaywrightAccount(accountId);

    // Then: returns false but touches lastAccountActivity to prevent idle context reaping
    assert.equal(result, false, "should return false on navigation failure");
    const activityAfter = _getLastAccountActivityForTesting(accountId) ?? 0;
    assert.ok(
      activityAfter > staleTimestamp,
      "lastAccountActivity must be updated on timeout to prevent reaper",
    );
    assert.ok(
      Date.now() - activityAfter < 5_000,
      "lastAccountActivity should be updated to approximately now",
    );
  } finally {
    _cleanupAccountForTesting(accountId);
  }
});

test("keepAlivePlaywrightAccount: does NOT update lastAccountActivity on fatal errors (context closed)", async () => {
  const {
    keepAlivePlaywrightAccount,
    _setAccountPageForTesting,
    _getLastAccountActivityForTesting,
    _setLastAccountActivityForTesting,
    _cleanupAccountForTesting,
  } = await import("../services/playwright.ts");

  // Given: an account where page.goto throws a fatal non-timeout error
  const accountId = "test-tor-fatal-account";
  const staleTimestamp = Date.now() - config.sessionKeeper.idleMs - 50_000;
  _setAccountPageForTesting(accountId, {
    url: () => "https://other.domain.com",
    isClosed: () => false,
    goto: async () => {
      throw new Error("Target page, context or browser has been closed");
    },
  });
  _setLastAccountActivityForTesting(accountId, staleTimestamp);

  try {
    // When: keepAlive runs and encounters a fatal browser close error
    const result = await keepAlivePlaywrightAccount(accountId);

    // Then: returns false and does NOT touch lastAccountActivity (reaper should clean dead context)
    assert.equal(result, false);
    const activityAfter = _getLastAccountActivityForTesting(accountId) ?? 0;
    assert.equal(
      activityAfter,
      staleTimestamp,
      "lastAccountActivity must NOT be updated on fatal context failure",
    );
  } finally {
    _cleanupAccountForTesting(accountId);
  }
});

test("isKeepAliveTimeoutError: correctly differentiates timeout vs fatal errors", async () => {
  const { isKeepAliveTimeoutError } = await import("../services/playwright.ts");

  // Given various error shapes
  assert.equal(isKeepAliveTimeoutError(new Error("page.goto: Timeout 15000ms exceeded.")), true);
  assert.equal(isKeepAliveTimeoutError(new Error("Navigation timeout of 15000 ms exceeded")), true);
  assert.equal(isKeepAliveTimeoutError(new Error("net::ERR_TIMED_OUT")), true);
  assert.equal(isKeepAliveTimeoutError(new Error("Target page, context or browser has been closed")), false);
  assert.equal(isKeepAliveTimeoutError(new Error("Connection refused")), false);
  assert.equal(isKeepAliveTimeoutError("timeout occurred"), true);
});

test("session keeper refreshes an expired token before keep-alive", async () => {
  const {
    _setAccountPageForTesting,
    _setLastAccountActivityForTesting,
    _cleanupAccountForTesting,
  } = await import("../services/playwright.ts");

  const accountId = "test-token-expired-account";
  const { page, calls } = fakeAccountPage();
  const ensureCalls: Array<{ accountId?: string; page?: unknown }> = [];
  _setAccountPageForTesting(accountId, page);
  _setLastAccountActivityForTesting(accountId, 0);
  _setTokenRefreshForTesting({
    hasExpiredToken: (id) => id === accountId,
    ensureUsableToken: async (id, refreshPage) => {
      ensureCalls.push({ accountId: id, page: refreshPage });
      return true;
    },
  });

  try {
    await runKeeperCycleWithTokens();

    assert.equal(ensureCalls.length, 1, "expired token must trigger one refresh");
    assert.equal(ensureCalls[0]?.accountId, accountId);
    assert.equal(ensureCalls[0]?.page, page, "refresh must receive the account page");
    assert.equal(calls.goto, 1, "keep-alive must still run after a refresh");
  } finally {
    _setTokenRefreshForTesting(null);
    _cleanupAccountForTesting(accountId);
  }
});

test("session keeper does not refresh a valid token", async () => {
  const {
    _setAccountPageForTesting,
    _setLastAccountActivityForTesting,
    _cleanupAccountForTesting,
  } = await import("../services/playwright.ts");

  const accountId = "test-token-valid-account";
  const { page, calls } = fakeAccountPage();
  let ensureCalls = 0;
  _setAccountPageForTesting(accountId, page);
  _setLastAccountActivityForTesting(accountId, 0);
  _setTokenRefreshForTesting({
    hasExpiredToken: () => false,
    ensureUsableToken: async () => {
      ensureCalls++;
      return true;
    },
  });

  try {
    await runKeeperCycleWithTokens();

    assert.equal(ensureCalls, 0, "valid token must not be refreshed");
    assert.equal(calls.goto, 1, "keep-alive must run normally");
  } finally {
    _setTokenRefreshForTesting(null);
    _cleanupAccountForTesting(accountId);
  }
});

test("session keeper survives a failed refresh and waits the interval before retrying", async () => {
  const {
    _setAccountPageForTesting,
    _setLastAccountActivityForTesting,
    _cleanupAccountForTesting,
  } = await import("../services/playwright.ts");

  const accountId = "test-token-failing-account";
  const { page, calls } = fakeAccountPage();
  let ensureCalls = 0;
  _setAccountPageForTesting(accountId, page);
  _setLastAccountActivityForTesting(accountId, 0);
  _setTokenRefreshForTesting({
    hasExpiredToken: () => true,
    ensureUsableToken: async () => {
      ensureCalls++;
      throw new Error("refresh boom");
    },
  });

  try {
    // When: the refresh throws, the cycle must resolve instead of propagating.
    await runKeeperCycleWithTokens();
    assert.equal(ensureCalls, 1);
    assert.equal(calls.goto, 1, "keep-alive must still run after a failed refresh");

    // Second cycle within the interval: retry must be throttled even after failure.
    _setLastAccountActivityForTesting(accountId, 0);
    await runKeeperCycleWithTokens();
    assert.equal(ensureCalls, 1, "failed refresh must not retry on every cycle");
    assert.equal(calls.goto, 2);
  } finally {
    _setTokenRefreshForTesting(null);
    _cleanupAccountForTesting(accountId);
  }
});
