/**
 * Quota / token / TMD wiring in the chat retry loop.
 */

import test from "node:test";
import assert from "node:assert";

process.env.TEST_MOCK_QWEN_AUTH = "true";
process.env.API_KEY = "";

import {
  classifyAccountRetryError,
  markQuotaExhaustedModel,
} from "../routes/chat/account.ts";
import {
  QwenSessionExpiredError,
  QwenUpstreamUnavailableError,
} from "../services/qwen.ts";
import { getNextAvailableAccount } from "../core/account-manager.ts";
import {
  clearAllAccountModelLimits,
  isAccountModelLimited,
} from "../core/account-model-limits.ts";
import { getDatabase } from "../core/database.ts";
import { invalidateAccountsCache } from "../core/accounts.ts";

test("classifyAccountRetryError: quota notice matches the daily limit", () => {
  assert.strictEqual(
    classifyAccountRetryError(
      new Error("You've reached today's limit for Qwen3.8-Max. Upgrade your membership."),
    ),
    "quota",
  );
  assert.strictEqual(
    classifyAccountRetryError(new Error("Allocated quota exceeded")),
    "quota",
  );
});

test("classifyAccountRetryError: TMD/WAF challenge wins over quota", () => {
  assert.strictEqual(
    classifyAccountRetryError(new Error("FAIL_SYS_USER_VALIDATE ...quota exceeded")),
    "tmd",
  );
  assert.strictEqual(
    classifyAccountRetryError(new Error("blocked by _____tmd_____ challenge")),
    "tmd",
  );
});

test("classifyAccountRetryError: expired session and 401 need a token", () => {
  assert.strictEqual(
    classifyAccountRetryError(new QwenSessionExpiredError("expired", "acc-1")),
    "relogin",
  );
  assert.strictEqual(
    classifyAccountRetryError(
      Object.assign(new Error("Unauthorized"), { upstreamStatus: 401 }),
    ),
    "relogin",
  );
});

test("classifyAccountRetryError: transient infra errors are not account faults", () => {
  assert.strictEqual(
    classifyAccountRetryError(
      new QwenUpstreamUnavailableError("Qwen upstream unavailable: 502 <html>", 502),
    ),
    "none",
  );
  assert.strictEqual(
    classifyAccountRetryError(new Error("Bad_Request")),
    "none",
  );
  assert.strictEqual(classifyAccountRetryError(new Error("Paris")), "none");
});

test("quota notice marks only the named model and rotation picks the next account", () => {
  const db = getDatabase();
  const existing = db.prepare("SELECT id, email, password FROM accounts").all();
  const insert = db.prepare(
    "INSERT INTO accounts (id, email, password) VALUES (?, ?, ?)",
  );

  db.prepare("DELETE FROM accounts").run();
  insert.run("quota-a", "quota-a@test.com", "x");
  insert.run("quota-b", "quota-b@test.com", "x");
  invalidateAccountsCache();
  clearAllAccountModelLimits();

  try {
    // The notice names another model than the one requested: the notice wins.
    const limited = markQuotaExhaustedModel(
      "quota-a",
      "qwen3.6-plus",
      "You've reached today's limit for Qwen3.8-Max.",
    );
    assert.strictEqual(limited.toLowerCase(), "qwen3.8-max");
    assert.strictEqual(isAccountModelLimited("quota-a", "qwen3.8-max"), true);
    assert.strictEqual(isAccountModelLimited("quota-a", "qwen3.6-plus"), false);

    // Same model on another account is still available, and rotation skips the
    // account whose quota for that model is exhausted.
    const next = getNextAvailableAccount(new Set(["quota-a"]), "qwen3.8-max");
    assert.strictEqual(next?.id, "quota-b");
  } finally {
    clearAllAccountModelLimits();
    db.prepare("DELETE FROM accounts").run();
    for (const row of existing as any[]) {
      insert.run(row.id, row.email, row.password);
    }
    invalidateAccountsCache();
  }
});
