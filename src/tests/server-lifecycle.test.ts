import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { getDatabase } from "../core/database.ts";
import { invalidateAccountsCache } from "../core/accounts.ts";
import {
  classifyStartupAccounts,
  startServer,
  stopServer,
} from "../api/server.ts";
import { config } from "../core/config.ts";

test("startup preserves active cooldowns and only clears expired ones", () => {
  const now = 1_000_000;
  const accounts = [
    { id: "active", cooldown_until: now + 60_000 },
    { id: "expired", cooldown_until: now - 1 },
    { id: "never", cooldown_until: 0 },
    { id: "unset", cooldown_until: null },
  ];

  const result = classifyStartupAccounts(accounts, now);

  assert.deepEqual(
    result.expiredCooldownAccounts.map((account) => account.id),
    ["expired"],
  );
  assert.deepEqual(
    result.availableAccounts.map((account) => account.id),
    ["expired", "never", "unset"],
  );
});

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

test("server lifecycle starts and stops without accounts or HTTP fallback", async (t) => {
  const port = config.server.port;
  if (!(await isPortAvailable(port))) {
    t.skip(`port ${port} is not available`);
    return;
  }

  const db = getDatabase();
  const existing = db
    .prepare(
      "SELECT id, email, password, cooldown_until, cooldown_reason FROM accounts",
    )
    .all() as any[];
  const originalQwenAccounts = process.env.QWEN_ACCOUNTS;

  try {
    delete process.env.QWEN_ACCOUNTS;
    db.prepare("DELETE FROM accounts").run();
    invalidateAccountsCache();

    const started = await startServer({ installSignalHandlers: false });
    assert.equal(started.port, port);
    assert.ok(started.url.includes(String(port)));

    await stopServer();
    await stopServer();
  } finally {
    await stopServer();
    const restoreDb = getDatabase();
    restoreDb.prepare("DELETE FROM accounts").run();
    const insert = restoreDb.prepare(
      "INSERT INTO accounts (id, email, password, cooldown_until, cooldown_reason) VALUES (?, ?, ?, ?, ?)",
    );
    for (const row of existing) {
      insert.run(
        row.id,
        row.email,
        row.password,
        row.cooldown_until ?? 0,
        row.cooldown_reason ?? null,
      );
    }
    invalidateAccountsCache();
    if (originalQwenAccounts === undefined) delete process.env.QWEN_ACCOUNTS;
    else process.env.QWEN_ACCOUNTS = originalQwenAccounts;
  }
});
