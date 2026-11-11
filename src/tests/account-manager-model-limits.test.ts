/**
 * Copyright (c) 2025 johngbl
 * QwenSofia - OpenAI-compatible proxy for Qwen
 */

import test, { after, beforeEach } from "node:test";
import assert from "node:assert";

process.env.TEST_MOCK_QWEN_AUTH = "true";
process.env.API_KEY = "";

import { getDatabase } from "../core/database.ts";
import { invalidateAccountsCache } from "../core/accounts.ts";
import {
  clearAccountCooldown,
  getAccountCooldownInfo,
  getNextAvailableAccount,
  isAccountAvailableForModel,
  markAccountRateLimited,
  quarantineAccount,
} from "../core/account-manager.ts";
import {
  clearAllAccountModelLimits,
  markAccountModelLimited,
} from "../core/account-model-limits.ts";

const MODEL = "qwen3.8-max";
const OTHER_MODEL = "qwen3.5-plus";

const db = getDatabase();
const existingRows = db
  .prepare(
    "SELECT id, email, password, cooldown_until, cooldown_reason FROM accounts",
  )
  .all() as any[];

function seedAccounts(ids: string[]): void {
  db.prepare("DELETE FROM accounts").run();
  const insert = db.prepare(
    "INSERT INTO accounts (id, email, password) VALUES (?, ?, ?)",
  );
  for (const id of ids) insert.run(id, `${id}@test.com`, "password");
  invalidateAccountsCache();
}

beforeEach(() => {
  process.env.QWEN_ACCOUNTS = "";
  clearAllAccountModelLimits();
  seedAccounts([]);
});

after(() => {
  db.prepare("DELETE FROM accounts").run();
  const insert = db.prepare(
    "INSERT INTO accounts (id, email, password, cooldown_until, cooldown_reason) VALUES (?, ?, ?, ?, ?)",
  );
  for (const row of existingRows) {
    insert.run(
      row.id,
      row.email,
      row.password,
      row.cooldown_until ?? 0,
      row.cooldown_reason ?? null,
    );
  }
  invalidateAccountsCache();
});

test("getNextAvailableAccount skips an account limited for the requested model", () => {
  seedAccounts(["acc-model-1", "acc-model-2"]);
  markAccountModelLimited("acc-model-1", MODEL, 60_000);

  for (let i = 0; i < 4; i++) {
    assert.strictEqual(
      getNextAvailableAccount(undefined, MODEL)?.id,
      "acc-model-2",
      "model-limited account must never be selected",
    );
  }

  assert.strictEqual(
    getNextAvailableAccount(undefined, "Qwen3.8-Max")?.id,
    "acc-model-2",
    "model ids are matched case-insensitively",
  );
});

test("getNextAvailableAccount also skips model-limited accounts in the cooldown fallback", () => {
  seedAccounts(["acc-cool-1", "acc-cool-2"]);
  markAccountRateLimited("acc-cool-1", 60_000);
  markAccountRateLimited("acc-cool-2", 30_000);
  markAccountModelLimited("acc-cool-2", MODEL, 60_000);

  // acc-cool-2 has the shortest cooldown but is out of quota for this model.
  assert.strictEqual(getNextAvailableAccount(undefined, MODEL)?.id, "acc-cool-1");

  markAccountModelLimited("acc-cool-1", MODEL, 60_000);
  assert.strictEqual(
    getNextAvailableAccount(undefined, MODEL),
    null,
    "no account can serve a model when every untried account is limited for it",
  );
});

test("getNextAvailableAccount does not skip an account limited for another model", () => {
  seedAccounts(["acc-model-1", "acc-model-2"]);
  markAccountModelLimited("acc-model-1", MODEL, 60_000);

  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const account = getNextAvailableAccount(undefined, OTHER_MODEL);
    assert.ok(account);
    seen.add(account.id);
  }
  assert.deepStrictEqual([...seen].sort(), ["acc-model-1", "acc-model-2"]);
});

test("getNextAvailableAccount keeps previous behavior when no model is given", () => {
  seedAccounts(["acc-only"]);
  markAccountModelLimited("acc-only", MODEL, 60_000);

  assert.strictEqual(getNextAvailableAccount()?.id, "acc-only");
  assert.strictEqual(getNextAvailableAccount("acc-only"), null);
  assert.strictEqual(getNextAvailableAccount(undefined, MODEL), null);
});

test("quarantineAccount marks a cooldown and removes the account from selection", () => {
  seedAccounts(["acc-q1", "acc-q2"]);

  quarantineAccount("acc-q1", "CaptchaLoop", 60_000);

  const info = getAccountCooldownInfo("acc-q1");
  assert.ok(info, "quarantined account must be on cooldown");
  assert.strictEqual(info!.reason, "CaptchaLoop");
  assert.ok(info!.remainingMs > 0 && info!.remainingMs <= 60_000);

  assert.strictEqual(isAccountAvailableForModel("acc-q1"), false);
  assert.strictEqual(isAccountAvailableForModel("acc-q1", MODEL), false);
  assert.strictEqual(getNextAvailableAccount(undefined, MODEL)?.id, "acc-q2");

  clearAccountCooldown("acc-q1");
});

test("isAccountAvailableForModel combines cooldown and model limits", () => {
  seedAccounts(["acc-model-1"]);
  markAccountModelLimited("acc-model-1", MODEL, 60_000);

  assert.strictEqual(isAccountAvailableForModel("acc-model-1", MODEL), false);
  assert.strictEqual(isAccountAvailableForModel("acc-model-1", OTHER_MODEL), true);
  assert.strictEqual(isAccountAvailableForModel("acc-model-1"), true);

  markAccountRateLimited("acc-model-1", 60_000);
  assert.strictEqual(isAccountAvailableForModel("acc-model-1"), false);
  assert.strictEqual(isAccountAvailableForModel("acc-model-1", OTHER_MODEL), false);

  clearAccountCooldown("acc-model-1");
});
