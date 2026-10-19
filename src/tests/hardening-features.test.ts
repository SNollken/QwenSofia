import { test } from "node:test";
import assert from "node:assert/strict";
import { isTmdChallenge } from "../services/qwen.ts";
import {
  msUntilMidnight,
  markAccountRateLimited,
  getAccountCooldownInfo,
  sweepExpiredCooldowns,
  resetStaleCooldowns,
  clearAccountCooldown,
} from "../core/account-manager.ts";
import { sweepStaleAccountSlots, acquireAccountRequestSlot, getAccountConcurrencyStats } from "../core/account-concurrency.ts";
import { isOverloadMessage, OVERLOAD_COOLDOWN_MS } from "../utils/overload-detector.ts";

test("isTmdChallenge: identifies WAF and captcha challenges", () => {
  assert.strictEqual(isTmdChallenge("FAIL_SYS_USER_VALIDATE"), true);
  assert.strictEqual(isTmdChallenge("error: _____tmd_____ challenge detected"), true);
  assert.strictEqual(isTmdChallenge("RGV587_ERROR"), true);
  assert.strictEqual(isTmdChallenge("<!doctypehtml><html lang=\"zh-cn\">"), true);
  assert.strictEqual(isTmdChallenge("<html><head><title>405 Not Allowed</title></head>"), true);
  assert.strictEqual(isTmdChallenge("normal text response"), false);
  assert.strictEqual(isTmdChallenge(""), false);
});

test("msUntilMidnight: returns valid millisecond duration until next 00:00", () => {
  const ms = msUntilMidnight();
  assert.ok(ms > 0, "Duration should be positive");
  assert.ok(ms <= 24 * 60 * 60 * 1000, "Duration should not exceed 24 hours");
});

test("OVERLOAD_COOLDOWN_MS: is 5 minutes", () => {
  assert.strictEqual(OVERLOAD_COOLDOWN_MS, 5 * 60 * 1000);
});

test("sweepStaleAccountSlots: frees slots held beyond maxAge", async () => {
  const release = await acquireAccountRequestSlot("stale-test-account");
  const statsBefore = getAccountConcurrencyStats();
  const accBefore = statsBefore.accounts.find((a) => a.accountId === "stale-test-account");
  assert.strictEqual(accBefore?.activeRequests, 1);

  // Sweep with a simulated future timestamp
  const now = Date.now();
  const swept = sweepStaleAccountSlots(now + 20 * 60 * 1000, 15 * 60 * 1000);
  assert.strictEqual(swept, 1);

  const statsAfter = getAccountConcurrencyStats();
  const accAfter = statsAfter.accounts.find((a) => a.accountId === "stale-test-account");
  assert.strictEqual(accAfter?.activeRequests ?? 0, 0);

  // Calling release afterwards should be a no-op / safe and not decrement active count of subsequent slots
  const releaseNext = await acquireAccountRequestSlot("stale-test-account");
  const statsNext = getAccountConcurrencyStats();
  const accNext = statsNext.accounts.find((a) => a.accountId === "stale-test-account");
  assert.strictEqual(accNext?.activeRequests, 1);

  release(); // release of swept slot should be a no-op

  const statsPreserved = getAccountConcurrencyStats();
  const accPreserved = statsPreserved.accounts.find((a) => a.accountId === "stale-test-account");
  assert.strictEqual(accPreserved?.activeRequests, 1, "Subsequent slot active count must not be decremented");

  releaseNext();
});

test("sweepExpiredCooldowns and resetStaleCooldowns: safely clean old account bans", () => {
  markAccountRateLimited("test-cooldown-account", 60_000);
  assert.ok(getAccountCooldownInfo("test-cooldown-account") !== null);

  // Expired sweep
  clearAccountCooldown("test-cooldown-account");
  assert.strictEqual(getAccountCooldownInfo("test-cooldown-account"), null);

  // Stale reset simulation
  markAccountRateLimited("stale-cooldown-account", 24 * 60 * 60 * 1000);
  const resetCount = resetStaleCooldowns(0);
  assert.ok(resetCount >= 1);
  assert.strictEqual(getAccountCooldownInfo("stale-cooldown-account"), null);
});

test("parseQwenErrorPayload: handles SSE comments and heartbeats gracefully", async () => {
  const { parseQwenErrorPayload } = await import("../routes/chat/errors.ts");
  assert.strictEqual(parseQwenErrorPayload(": heartbeat"), null);
  assert.strictEqual(parseQwenErrorPayload(": ping\n\n"), null);
  assert.strictEqual(parseQwenErrorPayload("data: {\"test\":1}"), null);
  assert.ok(parseQwenErrorPayload("unexpected html body") !== null);
});
