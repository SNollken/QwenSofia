import { test } from "node:test";
import assert from "node:assert";
import { getDatabase } from "../core/database.ts";
import { invalidateAccountsCache } from "../core/accounts.ts";
import {
  getNextAccount,
  getNextAvailableAccount,
  markAccountRateLimited,
} from "../core/account-manager.ts";
import { selectWarmAccount } from "../routes/chat/account.ts";
import { acquireAccountRequestSlot } from "../core/account-concurrency.ts";

test("Account Rotation: warm selection follows the round-robin anchor", () => {
  const accounts = [
    { id: "warm-1" },
    { id: "cold-1" },
    { id: "warm-2" },
    { id: "cold-2" },
  ];
  const activeAccountIds = new Set(["warm-1", "warm-2"]);

  assert.strictEqual(
    selectWarmAccount(accounts, activeAccountIds, "warm-1")?.id,
    "warm-1",
  );
  assert.strictEqual(
    selectWarmAccount(accounts, activeAccountIds, "cold-1")?.id,
    "warm-2",
  );
  assert.strictEqual(
    selectWarmAccount(accounts, activeAccountIds, "cold-2")?.id,
    "warm-1",
  );
});

test("Account Rotation: warm selection skips a full account", async () => {
  const first = await acquireAccountRequestSlot("warm-1");
  const second = await acquireAccountRequestSlot("warm-1");
  try {
    const selected = selectWarmAccount(
      [{ id: "warm-1" }, { id: "warm-2" }],
      new Set(["warm-1", "warm-2"]),
      "warm-1",
    );
    assert.equal(selected?.id, "warm-2");
  } finally {
    first();
    second();
  }
});

test("Account Rotation: warm selection skips a Playwright-busy account", () => {
  const selected = selectWarmAccount(
    [{ id: "warm-busy" }, { id: "warm-ready" }],
    new Set(["warm-busy", "warm-ready"]),
    "warm-busy",
    new Set(["warm-busy"]),
  );

  assert.equal(selected?.id, "warm-ready");
});

test("Account Rotation: Round-Robin rotation cycle", async () => {
  const originalEnv = process.env.QWEN_ACCOUNTS;
  delete process.env.QWEN_ACCOUNTS;

  const db = getDatabase();
  const existing = db
    .prepare(
      "SELECT id, email, password, cooldown_until, cooldown_reason FROM accounts",
    )
    .all();
  db.prepare("DELETE FROM accounts").run();
  invalidateAccountsCache();

  try {
    const insert = db.prepare(
      "INSERT INTO accounts (id, email, password) VALUES (?, ?, ?)",
    );
    insert.run("acc1", "account1@test.com", "password1");
    insert.run("acc2", "account2@test.com", "password2");
    insert.run("acc3", "account3@test.com", "password3");
    invalidateAccountsCache();

    const first = getNextAccount();
    const second = getNextAccount();
    const third = getNextAccount();
    const fourth = getNextAccount();

    assert.ok(first);
    assert.ok(second);
    assert.ok(third);
    assert.ok(fourth);

    assert.strictEqual(first!.email, "account1@test.com");
    assert.strictEqual(second!.email, "account2@test.com");
    assert.strictEqual(third!.email, "account3@test.com");
    assert.strictEqual(fourth!.email, "account1@test.com");
  } finally {
    db.prepare("DELETE FROM accounts").run();
    const insert = db.prepare(
      "INSERT INTO accounts (id, email, password, cooldown_until, cooldown_reason) VALUES (?, ?, ?, ?, ?)",
    );
    for (const row of existing as any[]) {
      insert.run(
        row.id,
        row.email,
        row.password,
        row.cooldown_until ?? 0,
        row.cooldown_reason ?? null,
      );
    }
    invalidateAccountsCache();
    if (originalEnv !== undefined) {
      process.env.QWEN_ACCOUNTS = originalEnv;
    }
  }
});

test("Account Rotation: returns account with shortest cooldown when all accounts are on cooldown", async () => {
  const originalEnv = process.env.QWEN_ACCOUNTS;
  delete process.env.QWEN_ACCOUNTS;

  const db = getDatabase();
  const existing = db
    .prepare(
      "SELECT id, email, password, cooldown_until, cooldown_reason FROM accounts",
    )
    .all();
  db.prepare("DELETE FROM accounts").run();
  invalidateAccountsCache();

  try {
    const insert = db.prepare(
      "INSERT INTO accounts (id, email, password) VALUES (?, ?, ?)",
    );
    insert.run("cool-acc-1", "cool1@test.com", "password1");
    insert.run("cool-acc-2", "cool2@test.com", "password2");
    invalidateAccountsCache();

    markAccountRateLimited("cool-acc-1", 60_000, "RateLimited");
    markAccountRateLimited("cool-acc-2", 30_000, "RateLimited");

    // When all accounts are on cooldown, returns the one with the shortest remaining cooldown.
    const next = getNextAccount();
    assert.ok(
      next !== null,
      "should return an account even when all are on cooldown",
    );
    assert.strictEqual(next!.id, "cool-acc-2"); // 30s cooldown is shorter

    const nextAvail = getNextAvailableAccount("cool-acc-1");
    assert.ok(
      nextAvail !== null,
      "should return an account even when remaining are on cooldown",
    );
    assert.strictEqual(nextAvail!.id, "cool-acc-2");
  } finally {
    db.prepare("DELETE FROM accounts").run();
    const insert = db.prepare(
      "INSERT INTO accounts (id, email, password, cooldown_until, cooldown_reason) VALUES (?, ?, ?, ?, ?)",
    );
    for (const row of existing as any[]) {
      insert.run(
        row.id,
        row.email,
        row.password,
        row.cooldown_until ?? 0,
        row.cooldown_reason ?? null,
      );
    }
    invalidateAccountsCache();
    if (originalEnv !== undefined) {
      process.env.QWEN_ACCOUNTS = originalEnv;
    }
  }
});
