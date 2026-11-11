import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  isTmdChallenge,
  parseQwenJsonError,
  createQwenChatSession,
} from "../services/qwen.ts";
import { UpstreamRateLimit } from "../core/errors.ts";
import {
  getAccountCooldownInfo,
  clearAccountCooldown,
} from "../core/account-manager.ts";
import {
  clearAllAccountModelLimits,
  getModelLimit,
} from "../core/account-model-limits.ts";
import * as qwenVersions from "../services/qwen-versions.ts";

const ACC = "tmd-test-acc";

beforeEach(() => {
  try { clearAccountCooldown(ACC); } catch {}
  try { clearAllAccountModelLimits(ACC); } catch {}
});

test("isTmdChallenge: true on known challenge markers", () => {
  assert.equal(isTmdChallenge("FAIL_SYS_USER_VALIDATE"), true);
  assert.equal(isTmdChallenge("... _____tmd_____ ..."), true);
  assert.equal(isTmdChallenge("RGV587_ERROR: blocked"), true);
  assert.equal(isTmdChallenge("<!doctypehtml><html>...</html>"), true);
  assert.equal(isTmdChallenge("<html><body>challenge</body></html>"), true);
});

test("isTmdChallenge: false on clean/empty responses", () => {
  assert.equal(isTmdChallenge(""), false);
  assert.equal(isTmdChallenge("all good"), false);
  assert.equal(isTmdChallenge('{"success":true}'), false);
  assert.equal(isTmdChallenge(null as unknown as string), false);
  assert.equal(isTmdChallenge(undefined as unknown as string), false);
});

test("isTmdChallenge: quarantines account and rotates Tor on hit", () => {
  const before = getAccountCooldownInfo(ACC);
  assert.equal(before, null);
  const hit = isTmdChallenge("FAIL_SYS_USER_VALIDATE", ACC);
  assert.equal(hit, true);
  const info = getAccountCooldownInfo(ACC);
  assert.ok(info?.onCooldown, "account should be quarantined");
  assert.equal(info?.reason, "TMDChallenge");
  // 30 minutes, allow slack
  assert.ok((info?.remainingMs ?? 0) > 29 * 60 * 1000);
});

test("isTmdChallenge: no quarantine for clean text or global account", () => {
  isTmdChallenge("FAIL_SYS_USER_VALIDATE", "global");
  assert.equal(getAccountCooldownInfo("global"), null);
  isTmdChallenge("clean", ACC);
  assert.equal(getAccountCooldownInfo(ACC), null);
});

test("quota/TMD error classification marks model limit (DailyLimit)", () => {
  const quotaJson = JSON.stringify({
    success: false,
    data: { code: "RateLimited", details: "You have reached the daily usage limit for qwen3.8-max." },
  });
  const err = parseQwenJsonError(quotaJson, 429, ACC, "qwen3.8-max");
  assert.ok(err instanceof UpstreamRateLimit);
  const limit = getModelLimit(ACC, "qwen3.8-max");
  assert.ok(limit, "model limit should be recorded");
  assert.equal(limit?.reason, "DailyLimit");
  // until ~midnight (>= a few minutes from now)
  assert.ok(limit!.until > Date.now() + 1000);
});

test("generic rate limit without daily notice does not mark model limit", () => {
  const quotaJson = JSON.stringify({
    success: false,
    data: { code: "RateLimited", details: "Too many requests, slow down." },
  });
  const err = parseQwenJsonError(quotaJson, 429, ACC, "qwen3.8-max");
  assert.ok(err instanceof UpstreamRateLimit);
  assert.equal(getModelLimit(ACC, "qwen3.8-max"), null);
});

test("createQwenChatSession payload uses dynamic Qwen web version", async () => {
  const original = global.fetch;
  let capturedBody: any = null;
  let capturedHeaders: Record<string, string> | null = null;
  try {
    qwenVersions.rememberQwenVersions({ webVersion: "9.9.9" });
    global.fetch = async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: { chat_id: "chat-123" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const id = await createQwenChatSession(
      { cookie: "c=1", "user-agent": "ua", "bx-v": "2.5.37" },
      "qwen3.5-plus",
      undefined,
      ACC,
    );
    assert.equal(id, "chat-123");
    assert.equal((capturedHeaders as Record<string, string> | null)?.version, "9.9.9");
    assert.equal((capturedHeaders as Record<string, string> | null)?.source, "web");
    assert.ok(capturedBody?.models?.includes("qwen3.5-plus"));
  } finally {
    global.fetch = original;
  }
});
