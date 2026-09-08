import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "qwenbridge-test-key";

import {
  invalidateAccountsCache,
  loadAccounts,
} from "../core/accounts.ts";
import { getDatabase } from "../core/database.ts";

function cleanAccounts(): void {
  getDatabase().prepare("DELETE FROM accounts").run();
  invalidateAccountsCache();
}

function captureWarnings(fn: () => void): string[] {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

test("QP-04: invalid entries with a password marker never reach the logs", () => {
  const MARKER = "SECRET-MARKER-do-not-log";
  const originalEnv = process.env.QWEN_ACCOUNTS;
  process.env.QWEN_ACCOUNTS = [`no-colon-${MARKER}`, `:${MARKER}`].join(";");

  cleanAccounts();
  try {
    const warnings = captureWarnings(() => loadAccounts());

    assert.ok(
      warnings.length >= 2,
      "expected one warning per invalid entry, got: " + warnings.join(" | "),
    );
    for (const warning of warnings) {
      assert.ok(
        !warning.includes(MARKER),
        `credential marker leaked into log: ${warning}`,
      );
    }
  } finally {
    if (originalEnv === undefined) delete process.env.QWEN_ACCOUNTS;
    else process.env.QWEN_ACCOUNTS = originalEnv;
    cleanAccounts();
  }
});

test("QP-04: empty-field warnings state the reason without the entry value", () => {
  const originalEnv = process.env.QWEN_ACCOUNTS;
  process.env.QWEN_ACCOUNTS = "user@example.com:";

  cleanAccounts();
  try {
    const warnings = captureWarnings(() => loadAccounts());

    assert.ok(warnings.length >= 1, "expected a warning for empty password");
    assert.ok(
      warnings.some((w) => w.includes("empty password")),
      "warning should name the empty field: " + warnings.join(" | "),
    );
    for (const warning of warnings) {
      assert.ok(
        !warning.includes("user@example.com:"),
        `raw entry leaked into log: ${warning}`,
      );
    }
  } finally {
    if (originalEnv === undefined) delete process.env.QWEN_ACCOUNTS;
    else process.env.QWEN_ACCOUNTS = originalEnv;
    cleanAccounts();
  }
});

test("QP-04: valid entries still parse and sync after the redaction fix", () => {
  const originalEnv = process.env.QWEN_ACCOUNTS;
  process.env.QWEN_ACCOUNTS =
    "redact1@example.com:alpha;redact2@example.com:beta";

  cleanAccounts();
  try {
    const warnings = captureWarnings(() => loadAccounts());
    assert.equal(warnings.length, 0, "valid entries must not warn");

    const accounts = loadAccounts();
    assert.deepEqual(
      accounts.map((account) => account.email),
      ["redact1@example.com", "redact2@example.com"],
    );
    assert.ok(
      accounts.every((account) => account.password === "***"),
      "loadAccounts must keep masking passwords",
    );
  } finally {
    if (originalEnv === undefined) delete process.env.QWEN_ACCOUNTS;
    else process.env.QWEN_ACCOUNTS = originalEnv;
    cleanAccounts();
  }
});
