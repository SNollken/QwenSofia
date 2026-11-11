import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearAccountModelLimit,
  clearAllAccountModelLimits,
  getModelLimit,
  getModelLimitRemainingMs,
  isAccountModelLimited,
  listModelLimits,
  loadModelLimits,
  markAccountModelLimited,
  normalizeModelId,
} from "../core/account-model-limits.ts";
import {
  listPersistedModelLimits,
  upsertModelLimit,
} from "../core/database.ts";

/** Seeds the database directly; returns false when persistence is unavailable. */
function seedPersisted(row: {
  accountId: string;
  model: string;
  until: number;
  reason: string;
  updatedAt: number;
}): boolean {
  try {
    upsertModelLimit(row);
    return true;
  } catch {
    return false;
  }
}

function persistedRows(accountId: string) {
  try {
    return listPersistedModelLimits().filter((r) => r.account_id === accountId);
  } catch {
    return [];
  }
}

test("account-model-limits: normalize model ids", () => {
  assert.equal(normalizeModelId("Qwen3.8-Max"), "qwen3.8-max");
  assert.equal(normalizeModelId("  qwen3.8-max  "), "qwen3.8-max");
  assert.equal(normalizeModelId("qwen3.8-max-no-thinking"), "qwen3.8-max");
  assert.equal(normalizeModelId("QWEN3.8-MAX-NO-THINKING"), "qwen3.8-max");
  assert.equal(normalizeModelId(""), "");
});

test("account-model-limits: mark, read and remaining time", () => {
  const account = "acc-mark";
  clearAllAccountModelLimits(account);

  assert.equal(isAccountModelLimited(account, "qwen3.8-max"), false);
  assert.equal(getModelLimit(account, "qwen3.8-max"), null);
  assert.equal(getModelLimitRemainingMs(account, "qwen3.8-max"), 0);

  markAccountModelLimited(account, "Qwen3.8-Max", 60_000, "DailyLimit");

  const entry = getModelLimit(account, "qwen3.8-max-no-thinking");
  assert.ok(entry);
  assert.equal(entry.accountId, account);
  assert.equal(entry.model, "qwen3.8-max");
  assert.equal(entry.reason, "DailyLimit");
  assert.equal(isAccountModelLimited(account, " qwen3.8-max "), true);

  const remaining = getModelLimitRemainingMs(account, "qwen3.8-max");
  assert.ok(remaining > 0 && remaining <= 60_000, `remaining=${remaining}`);

  // Other models of the same account stay usable.
  assert.equal(isAccountModelLimited(account, "qwen3.6-plus"), false);

  clearAllAccountModelLimits(account);
});

test("account-model-limits: marking again extends but never shortens", () => {
  const account = "acc-extend";
  clearAllAccountModelLimits(account);

  markAccountModelLimited(account, "qwen3.8-max", 60_000);
  const first = getModelLimit(account, "qwen3.8-max")?.until;
  assert.ok(first);

  markAccountModelLimited(account, "qwen3.8-max", 1_000);
  assert.equal(getModelLimit(account, "qwen3.8-max")?.until, first);

  markAccountModelLimited(account, "qwen3.8-max", 120_000);
  const extended = getModelLimit(account, "qwen3.8-max")?.until;
  assert.ok(extended && extended > first);

  clearAllAccountModelLimits(account);
});

test("account-model-limits: expired limits are dropped", () => {
  const account = "acc-expired";
  clearAllAccountModelLimits(account);

  markAccountModelLimited(account, "qwen3.8-max", 0);
  assert.equal(isAccountModelLimited(account, "qwen3.8-max"), false);
  assert.equal(getModelLimit(account, "qwen3.8-max"), null);
  assert.equal(getModelLimitRemainingMs(account, "qwen3.8-max"), 0);
  assert.deepEqual(listModelLimits("qwen3.8-max").filter((e) => e.accountId === account), []);
});

test("account-model-limits: clear one model, one account, or everything", () => {
  clearAllAccountModelLimits();

  markAccountModelLimited("acc-clear-a", "qwen3.8-max", 60_000);
  markAccountModelLimited("acc-clear-a", "qwen3.6-plus", 60_000);
  markAccountModelLimited("acc-clear-b", "qwen3.8-max", 60_000);

  clearAccountModelLimit("acc-clear-a", "qwen3.8-max");
  assert.equal(isAccountModelLimited("acc-clear-a", "qwen3.8-max"), false);
  assert.equal(isAccountModelLimited("acc-clear-a", "qwen3.6-plus"), true);

  clearAllAccountModelLimits("acc-clear-a");
  assert.equal(isAccountModelLimited("acc-clear-a", "qwen3.6-plus"), false);
  assert.equal(isAccountModelLimited("acc-clear-b", "qwen3.8-max"), true);

  clearAllAccountModelLimits();
  assert.deepEqual(listModelLimits(), []);
});

test("account-model-limits: list snapshots and filters by model", () => {
  clearAllAccountModelLimits();

  markAccountModelLimited("acc-list-a", "qwen3.8-max", 60_000);
  markAccountModelLimited("acc-list-b", "qwen3.8-max-no-thinking", 60_000);
  markAccountModelLimited("acc-list-c", "qwen3.6-plus", 60_000);

  assert.equal(listModelLimits().length, 3);
  const max = listModelLimits("qwEN3.8-MAX");
  assert.equal(max.length, 2);
  assert.deepEqual(max.map((e) => e.accountId).sort(), ["acc-list-a", "acc-list-b"]);
  assert.equal(listModelLimits("unknown-model").length, 0);

  clearAllAccountModelLimits();
});

test("account-model-limits: mark persists and clear removes the row", (t) => {
  const account = "acc-db-roundtrip";
  clearAllAccountModelLimits(account);

  markAccountModelLimited(account, "Qwen3.8-Max", 60_000, "DailyLimit");
  const rows = persistedRows(account);
  if (rows.length === 0) return t.skip("persistence unavailable");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, "qwen3.8-max");
  assert.equal(rows[0].reason, "DailyLimit");
  assert.ok(rows[0].until > Date.now());

  clearAccountModelLimit(account, "qwen3.8-max");
  assert.deepEqual(persistedRows(account), []);
});

test("account-model-limits: loadModelLimits restores live rows only", (t) => {
  const account = "acc-db-load";
  clearAllAccountModelLimits(account);
  const now = Date.now();
  const seeded =
    seedPersisted({
      accountId: account,
      model: "qwen3.8-max-no-thinking",
      until: now + 60_000,
      reason: "Persisted",
      updatedAt: now,
    }) &&
    seedPersisted({
      accountId: account,
      model: "qwen3.6-plus",
      until: now - 1_000,
      reason: "Stale",
      updatedAt: now - 2_000,
    });
  if (!seeded) return t.skip("persistence unavailable");

  loadModelLimits();

  const entry = getModelLimit(account, "qwen3.8-max");
  assert.equal(entry?.reason, "Persisted");
  assert.equal(entry?.model, "qwen3.8-max");
  assert.equal(isAccountModelLimited(account, "qwen3.6-plus"), false);

  clearAllAccountModelLimits(account);
  assert.deepEqual(persistedRows(account), []);
});

test("account-model-limits: unusable persistence never throws", () => {
  // database.ts may not expose the model_limit functions (or the database may
  // be unavailable). Every operation must stay best-effort and in-memory.
  assert.doesNotThrow(() => loadModelLimits());
  assert.doesNotThrow(() => markAccountModelLimited("acc-persist", "qwen3.8-max", 60_000));
  assert.equal(isAccountModelLimited("acc-persist", "qwen3.8-max"), true);
  assert.doesNotThrow(() => loadModelLimits());
  assert.equal(isAccountModelLimited("acc-persist", "qwen3.8-max"), true);
  assert.doesNotThrow(() => clearAccountModelLimit("acc-persist", "qwen3.8-max"));
  assert.doesNotThrow(() => clearAllAccountModelLimits("acc-persist"));
  assert.doesNotThrow(() => clearAllAccountModelLimits());
  assert.doesNotThrow(() => listModelLimits());
});
