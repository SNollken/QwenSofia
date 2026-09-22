import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../core/config.ts";
import {
  isSessionKeeperRunning,
  runSessionKeeperOnceForTesting,
  startSessionKeeper,
  stopSessionKeeper,
} from "../services/session-keeper.ts";

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
