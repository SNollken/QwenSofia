import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TEST_MOCK_QWEN_AUTH = "true";

import { app, assertExposureCredentials } from "../api/server.ts";
import { config } from "../core/config.ts";

const SAVED_ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SAVED_ADMIN_HOST = config.server.host;

function setAdminToken(value: string | undefined): void {
  if (value === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = value;
}

test("admin routes allow loopback access without ADMIN_TOKEN", async () => {
  setAdminToken(undefined);
  config.server.host = "127.0.0.1";
  try {
    const requests = [
      new Request("http://localhost/api/admin/overview"),
      new Request("http://localhost/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      new Request("http://localhost/api/admin/account-creator/run", {
        method: "POST",
      }),
    ];
    for (const request of requests) {
      const response = await app.fetch(request);
      assert.notEqual(response.status, 401);
      assert.notEqual(response.status, 503);
    }
  } finally {
    setAdminToken(SAVED_ADMIN_TOKEN);
    config.server.host = SAVED_ADMIN_HOST;
  }
});

test("admin routes require the configured ADMIN_TOKEN outside loopback", async () => {
  setAdminToken("test-admin-token");
  config.server.host = "0.0.0.0";
  try {
    const missing = await app.fetch(
      new Request("http://localhost/api/admin/overview"),
    );
    assert.equal(missing.status, 401);

    const wrong = await app.fetch(
      new Request("http://localhost/api/admin/overview", {
        headers: { "X-Admin-Token": "wrong-token" },
      }),
    );
    assert.equal(wrong.status, 401);

    const ok = await app.fetch(
      new Request("http://localhost/api/admin/overview", {
        headers: { "X-Admin-Token": "test-admin-token" },
      }),
    );
    assert.notEqual(ok.status, 401, "valid token must not be rejected");
    assert.notEqual(ok.status, 503, "valid token must not hit the disabled path");
  } finally {
    setAdminToken(SAVED_ADMIN_TOKEN);
    config.server.host = SAVED_ADMIN_HOST;
  }
});

test("admin routes rate limit repeated requests per client", async () => {
  setAdminToken("test-admin-token");
  try {
    let last: Response | undefined;
    for (let i = 0; i < 61; i++) {
      last = await app.fetch(
        new Request("http://localhost/api/admin/overview", {
          headers: {
            "X-Admin-Token": "test-admin-token",
            "x-forwarded-for": "203.0.113.9",
          },
        }),
      );
    }
    assert.equal(last!.status, 429, "61st request within the window must be rate limited");
  } finally {
    setAdminToken(SAVED_ADMIN_TOKEN);
  }
});

test("assertExposureCredentials enforces credentials on non-loopback binds", () => {
  assertExposureCredentials({ host: "127.0.0.1" });
  assertExposureCredentials({ host: "::1" });
  assertExposureCredentials({ host: "localhost" });

  assert.throws(
    () => assertExposureCredentials({ host: "0.0.0.0" }),
    /API_KEY.*ADMIN_TOKEN|ADMIN_TOKEN.*API_KEY/s,
  );
  assert.throws(
    () => assertExposureCredentials({ host: "10.0.0.5", apiKey: "k" }),
    /ADMIN_TOKEN/,
  );
  assert.throws(
    () => assertExposureCredentials({ host: "10.0.0.5", adminToken: "t" }),
    /API_KEY/,
  );
  assertExposureCredentials({
    host: "0.0.0.0",
    apiKey: "k",
    adminToken: "t",
  });
});

test("HOST defaults to loopback", async () => {
  const { readFileSync } = await import("node:fs");
  const configSource = readFileSync(
    new URL("../core/config.ts", import.meta.url),
    "utf8",
  );
  const hostLine = configSource
    .split("\n")
    .find((line) => line.trim().startsWith("HOST:"));
  assert.ok(hostLine, "HOST entry must exist in config schema");
  assert.ok(
    hostLine!.includes('"127.0.0.1"'),
    "HOST must default to loopback, got: " + hostLine!.trim(),
  );
});
